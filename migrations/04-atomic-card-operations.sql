-- Run after migrations 01, 02 and 03, before deploying this release.
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
 ELSIF p_action IN ('save_cards_atomic','delete_card_atomic') THEN
   IF jsonb_typeof(p_expected->'cards') IS DISTINCT FROM 'array'
      OR jsonb_typeof(p_expected->'transactions') IS DISTINCT FROM 'array' THEN
     RETURN '{"success":false,"statusCode":400,"code":"EXPECTED_FINANCIAL_STATE_REQUIRED"}'::jsonb;
   END IF;
   IF p_action='save_cards_atomic' THEN
     IF jsonb_typeof(p_payload->'cards') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p_payload->'transactions') IS DISTINCT FROM 'array' THEN
       RETURN '{"success":false,"statusCode":400,"code":"INVALID_CARD_OPERATION"}'::jsonb;
     END IF;
     -- Exact replay is harmless. A newer state must be reviewed before retrying.
     IF card_list=p_payload->'cards' AND txs=(p_payload->'transactions') || (p_expected->'transactions') THEN
       RETURN '{"success":true,"statusCode":200}'::jsonb;
     END IF;
   END IF;
   IF card_list<>p_expected->'cards' OR txs<>p_expected->'transactions' THEN RETURN conflict; END IF;
   IF p_action='save_cards_atomic' THEN
     IF jsonb_array_length(p_payload->'transactions')>100 THEN
       RETURN '{"success":false,"statusCode":400,"code":"INVALID_TRANSACTIONS"}'::jsonb;
     END IF;
     FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'cards') LOOP
       tx_id:=item->>'id';
       IF jsonb_typeof(item)<>'object' OR coalesce(tx_id,'')='' OR tx_id=ANY(seen) THEN
         RETURN '{"success":false,"statusCode":400,"code":"INVALID_CARD_ID"}'::jsonb;
       END IF;
       seen:=array_append(seen,tx_id);
     END LOOP;
     seen:=ARRAY[]::text[];
     FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'transactions') LOOP
       tx_id:=item->>'id';
       IF jsonb_typeof(item)<>'object' OR coalesce(tx_id,'')='' OR length(tx_id)>200 OR tx_id=ANY(seen) THEN
         RETURN '{"success":false,"statusCode":400,"code":"INVALID_TRANSACTION_ID"}'::jsonb;
       END IF;
       IF jsonb_typeof(item->'amount') IS DISTINCT FROM 'number' OR item->>'type' NOT IN ('income','expense') OR item->>'type' IS NULL THEN
         RETURN '{"success":false,"statusCode":400,"code":"INVALID_ADJUSTMENT"}'::jsonb;
       END IF;
       seen:=array_append(seen,tx_id);
       IF EXISTS (SELECT 1 FROM jsonb_array_elements(txs) t WHERE t->>'id'=tx_id) THEN RETURN conflict; END IF;
     END LOOP;
     card_list:=p_payload->'cards';
     txs:=(p_payload->'transactions') || txs;
   ELSE
     tx_id:=p_payload->>'id';
     SELECT value INTO previous FROM jsonb_array_elements(card_list) WHERE value->>'id'=tx_id LIMIT 1;
     IF previous IS NULL THEN RETURN '{"success":true,"statusCode":200}'::jsonb; END IF;
     -- Existing history already contributes to total balance. Move its account
     -- attribution to cash; only the legacy initial balance needs a new entry.
     SELECT coalesce(jsonb_agg(CASE WHEN value->>'cardId'=tx_id
       THEN value || jsonb_build_object('cardId','cash','removedCardId',tx_id) ELSE value END ORDER BY ord),'[]') INTO txs
       FROM jsonb_array_elements(txs) WITH ORDINALITY AS entries(value,ord);
     IF coalesce(nullif(regexp_replace(previous->>'balance','[ ,[:space:]]','','g'),''),'0')::numeric <> 0 THEN
       IF EXISTS (SELECT 1 FROM jsonb_array_elements(txs) t WHERE t->>'id'='card_removed_' || tx_id) THEN RETURN conflict; END IF;
       item:=jsonb_build_object('id','card_removed_' || tx_id,'cardId','cash',
         'amount',regexp_replace(previous->>'balance','[ ,[:space:]]','','g')::numeric,
         'type',CASE WHEN regexp_replace(previous->>'balance','[ ,[:space:]]','','g')::numeric>0 THEN 'income' ELSE 'expense' END,
         'note','Karta o‘chirildi (boshlang‘ich balans saqlandi)', 'category','Boshqa',
         'date',to_char(clock_timestamp() AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD'));
       txs:=jsonb_build_array(item) || txs;
     END IF;
     SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]') INTO card_list
       FROM jsonb_array_elements(card_list) WITH ORDINALITY AS entries(value,ord) WHERE value->>'id' IS DISTINCT FROM tx_id;
   END IF;
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
