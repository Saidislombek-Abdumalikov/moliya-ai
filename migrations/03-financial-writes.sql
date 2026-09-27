-- Run after migrations 01 and 02, before deploying this release.
BEGIN;
CREATE OR REPLACE FUNCTION public.moliya_financial_write(
 p_user_id text, p_action text, p_payload jsonb, p_expected jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 u public.users%ROWTYPE; txs jsonb; card_list jsonb; item jsonb; previous jsonb;
 new_items jsonb:='[]'; tx_id text; seen text[]:=ARRAY[]::text[];
 conflict jsonb:='{"success":false,"statusCode":409,"code":"FINANCIAL_CONFLICT"}';
BEGIN
 SELECT * INTO u FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR p_user_id !~ '^moliya_user_tg_[0-9]+$' THEN
   RETURN '{"success":false,"statusCode":404,"code":"USER_NOT_FOUND"}'::jsonb;
 END IF;
 txs:=coalesce(u.transactions,'[]'); card_list:=coalesce(u.cards,'[]');
 IF jsonb_typeof(txs)<>'array' OR jsonb_typeof(card_list)<>'array' THEN
   RAISE EXCEPTION 'Invalid stored financial arrays';
 END IF;
 IF p_action='append_transactions' THEN
   IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload)>100 THEN
     RETURN '{"success":false,"statusCode":400,"code":"INVALID_TRANSACTIONS"}'::jsonb;
   END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p_payload) LOOP
     tx_id:=item->>'id';
     IF jsonb_typeof(item)<>'object' OR coalesce(tx_id,'')='' OR length(tx_id)>200 OR tx_id=ANY(seen) THEN
       RETURN '{"success":false,"statusCode":400,"code":"INVALID_TRANSACTION_ID"}'::jsonb;
     END IF;
     seen:=array_append(seen,tx_id);
     SELECT value INTO previous FROM jsonb_array_elements(txs) WHERE value->>'id'=tx_id LIMIT 1;
     IF previous IS NOT NULL AND previous<>item THEN RETURN conflict; END IF;
     IF previous IS NULL THEN new_items:=new_items || jsonb_build_array(item); END IF;
   END LOOP;
   txs:=new_items || txs;
 ELSIF p_action='put_transaction' THEN
   tx_id:=p_payload->>'id';
   IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR coalesce(tx_id,'')='' OR length(tx_id)>200 THEN
     RETURN '{"success":false,"statusCode":400,"code":"INVALID_TRANSACTION_ID"}'::jsonb;
   END IF;
   SELECT value INTO previous FROM jsonb_array_elements(txs) WHERE value->>'id'=tx_id LIMIT 1;
   IF previous IS DISTINCT FROM p_payload THEN
     IF previous IS DISTINCT FROM nullif(p_expected,'null'::jsonb) THEN RETURN conflict; END IF;
     SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO txs
       FROM jsonb_array_elements(txs) WITH ORDINALITY AS entries(value,ord) WHERE value->>'id' IS DISTINCT FROM tx_id;
     txs:=jsonb_build_array(p_payload) || txs;
   END IF;
 ELSIF p_action='delete_transaction' THEN
   tx_id:=p_payload->>'id';
   IF coalesce(tx_id,'')='' THEN RETURN '{"success":false,"statusCode":400,"code":"INVALID_TRANSACTION_ID"}'::jsonb; END IF;
   SELECT value INTO previous FROM jsonb_array_elements(txs) WHERE value->>'id'=tx_id LIMIT 1;
   IF previous IS NOT NULL AND nullif(p_expected,'null'::jsonb) IS NOT NULL AND previous<>p_expected THEN RETURN conflict; END IF;
   SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO txs
     FROM jsonb_array_elements(txs) WITH ORDINALITY AS entries(value,ord) WHERE value->>'id' IS DISTINCT FROM tx_id;
 ELSIF p_action='replace_cards' THEN
   IF jsonb_typeof(p_payload) IS DISTINCT FROM 'array' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'array' THEN
     RETURN '{"success":false,"statusCode":400,"code":"EXPECTED_CARDS_REQUIRED"}'::jsonb;
   END IF;
   IF card_list<>p_payload AND card_list<>p_expected THEN RETURN conflict; END IF;
   card_list:=p_payload;
 ELSE RETURN '{"success":false,"statusCode":400,"code":"INVALID_FINANCIAL_ACTION"}'::jsonb;
 END IF;
 UPDATE public.users SET transactions=txs,cards=card_list,updated_at=clock_timestamp() WHERE id=p_user_id;
 RETURN '{"success":true,"statusCode":200}'::jsonb;
END;
$$;
-- Caller identity/eligibility is checked by the backend. Never grant browser execution.
REVOKE ALL ON FUNCTION public.moliya_financial_write(text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_financial_write(text,text,jsonb,jsonb) TO service_role;
COMMIT;
