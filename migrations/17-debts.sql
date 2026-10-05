-- Apply after migrations 01–16. No existing financial records are deleted.
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_debt_delivery (
 user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 tx_id text NOT NULL, due_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('early','due')),
 status text NOT NULL DEFAULT 'claimed', created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,tx_id,due_date,kind)
);
ALTER TABLE public.moliya_debt_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_debt_delivery FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.moliya_debt_delivery TO service_role;

-- Keep old financial checks and add atomic protection for repayment records.
DO $$ BEGIN
 IF to_regprocedure('public.moliya_financial_write_v17_base(text,text,jsonb,jsonb)') IS NULL THEN
  ALTER FUNCTION public.moliya_financial_write(text,text,jsonb,jsonb) RENAME TO moliya_financial_write_v17_base;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.moliya_financial_write(p_user_id text,p_action text,p_payload jsonb,p_expected jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE txs jsonb; old jsonb; item jsonb;
BEGIN
 SELECT transactions INTO txs FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF p_action IN ('put_transaction','delete_transaction') THEN
  SELECT value INTO old FROM jsonb_array_elements(coalesce(txs,'[]')) WHERE value->>'id'=p_payload->>'id';
  IF old ? 'debtPaymentFor' OR p_payload ? 'debtPaymentFor' THEN
   RETURN '{"success":false,"statusCode":400,"code":"USE_DEBT_ACTION"}'::jsonb;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(txs,'[]')) WHERE value->>'debtPaymentFor'=p_payload->>'id') AND
     (p_action='delete_transaction' OR old->'amount' IS DISTINCT FROM p_payload->'amount' OR old->'type' IS DISTINCT FROM p_payload->'type' OR old->'cardId' IS DISTINCT FROM p_payload->'cardId') THEN
   RETURN '{"success":false,"statusCode":409,"code":"DEBT_HAS_PAYMENTS"}'::jsonb;
  END IF;
 ELSIF p_action='append_transactions' AND jsonb_typeof(p_payload)='array' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
   IF item ? 'debtPaymentFor' THEN RETURN '{"success":false,"statusCode":400,"code":"USE_DEBT_ACTION"}'::jsonb; END IF;
  END LOOP;
 ELSIF p_action='save_cards_atomic' AND jsonb_typeof(p_payload->'transactions')='array' THEN
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'transactions') LOOP
   IF item ? 'debtPaymentFor' THEN RETURN '{"success":false,"statusCode":400,"code":"USE_DEBT_ACTION"}'::jsonb; END IF;
  END LOOP;
 END IF;
 RETURN public.moliya_financial_write_v17_base(p_user_id,p_action,p_payload,p_expected);
END $$;
REVOKE ALL ON FUNCTION public.moliya_financial_write(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_financial_write(text,text,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.moliya_debt_action(p_user_id text,p_session_token text,p_tx_id text,p_action text,p_payload jsonb,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE txs jsonb; old jsonb; updated jsonb; reply jsonb; payment jsonb; remaining numeric; amount numeric; pid text; due text; day text;
BEGIN
 SELECT transactions INTO txs FROM public.users WHERE id=p_user_id FOR UPDATE;
 SELECT value INTO old FROM jsonb_array_elements(coalesce(txs,'[]')) WHERE value->>'id'=p_tx_id;
 IF old IS NULL OR old->>'type' NOT IN ('debt','lending') THEN RETURN '{"success":false,"statusCode":404,"code":"DEBT_NOT_FOUND"}'::jsonb; END IF;
 -- Existing session-bound function checks expiry, restrictions and bot eligibility under this lock.
 reply:=public.moliya_session_financial_write(p_user_id,p_session_token,'put_transaction',old,old);
 IF (reply->>'success')::boolean IS NOT TRUE THEN RETURN reply; END IF;
 day:=to_char(clock_timestamp() AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD');
 IF p_action='pay' THEN
  pid:=p_payload->>'paymentId';
  IF pid IS NULL OR pid !~ '^pay_[a-zA-Z0-9_-]{10,80}$' THEN RETURN '{"success":false,"statusCode":400,"code":"INVALID_PAYMENT"}'::jsonb; END IF;
  SELECT value INTO payment FROM jsonb_array_elements(txs) WHERE value->>'id'=pid;
  IF payment IS NOT NULL THEN
   IF payment->>'debtPaymentFor'=p_tx_id AND abs((payment->>'amount')::numeric)=(p_payload->>'amount')::numeric THEN RETURN jsonb_build_object('success',true,'transactions',txs); END IF;
   RETURN '{"success":false,"statusCode":409,"code":"PAYMENT_CONFLICT"}'::jsonb;
  END IF;
 END IF;
 IF old IS DISTINCT FROM p_expected THEN RETURN '{"success":false,"statusCode":409,"code":"DEBT_CHANGED"}'::jsonb; END IF;
 IF p_action='pay' THEN
  amount:=(p_payload->>'amount')::numeric;
  SELECT abs((old->>'amount')::numeric)-coalesce(sum(abs((value->>'amount')::numeric)),0) INTO remaining FROM jsonb_array_elements(txs) WHERE value->>'debtPaymentFor'=p_tx_id;
  IF amount IS NULL OR amount<=0 OR amount>remaining OR amount<>round(amount,2) THEN RETURN '{"success":false,"statusCode":400,"code":"INVALID_PAYMENT_AMOUNT"}'::jsonb; END IF;
  payment:=jsonb_build_object('id',pid,'type',CASE WHEN old->>'type'='debt' THEN 'expense' ELSE 'income' END,
   'amount',CASE WHEN old->>'type'='debt' THEN -amount ELSE amount END,'debtPaymentFor',p_tx_id,
   'category','Qarz qaytarish','title',coalesce(old->>'debtWho','Qarz'),'note','Qarz qaytarish',
   'cardId',coalesce(old->>'cardId','cash'),'date',day,'day',extract(day FROM clock_timestamp() AT TIME ZONE 'Asia/Tashkent'),
   'month',extract(month FROM clock_timestamp() AT TIME ZONE 'Asia/Tashkent'),'year',extract(year FROM clock_timestamp() AT TIME ZONE 'Asia/Tashkent'));
  txs:=jsonb_build_array(payment)||txs;
 ELSIF p_action='edit' THEN
  due:=nullif(p_payload->>'dueDate','');
  IF due IS NOT NULL AND (due !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(due::date,'YYYY-MM-DD')<>due) THEN RETURN '{"success":false,"statusCode":400,"code":"INVALID_DUE_DATE"}'::jsonb; END IF;
  IF length(coalesce(p_payload->>'personName','')) NOT BETWEEN 1 AND 100 OR length(coalesce(p_payload->>'personId','')) NOT BETWEEN 1 AND 100 THEN RETURN '{"success":false,"statusCode":400,"code":"INVALID_PERSON"}'::jsonb; END IF;
  updated:=old||jsonb_build_object('debtDueDate',due,'debtDateConfirmed',true,'debtWho',p_payload->>'personName','debtPersonId',p_payload->>'personId','debtDismissed',NULL);
  SELECT jsonb_agg(CASE WHEN value->>'id'=p_tx_id THEN updated ELSE value END ORDER BY ord) INTO txs FROM jsonb_array_elements(txs) WITH ORDINALITY AS x(value,ord);
 ELSIF p_action='dismiss' THEN
  updated:=old||jsonb_build_object('debtDismissed',coalesce(old->>'debtDueDate','')||':'||day);
  SELECT jsonb_agg(CASE WHEN value->>'id'=p_tx_id THEN updated ELSE value END ORDER BY ord) INTO txs FROM jsonb_array_elements(txs) WITH ORDINALITY AS x(value,ord);
 ELSE RETURN '{"success":false,"statusCode":400,"code":"INVALID_DEBT_ACTION"}'::jsonb;
 END IF;
 UPDATE public.users SET transactions=txs,updated_at=clock_timestamp() WHERE id=p_user_id;
 RETURN jsonb_build_object('success',true,'transactions',txs);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RETURN '{"success":false,"statusCode":400,"code":"INVALID_DEBT_INPUT"}'::jsonb;
END $$;
REVOKE ALL ON FUNCTION public.moliya_debt_action(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_debt_action(text,text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
