-- Run BEFORE deploying the matching code (the new code reads and writes this table).
-- Old code keeps working after this runs: it never touches the new table.
--
-- Why: Telegram chat history lived in users.onboarding.bot_messages (up to 500
-- entries), so every profile read/write moved the whole history. One row per
-- message keeps the users row small. History starts empty (data was reset).
BEGIN;
CREATE TABLE IF NOT EXISTS public.moliya_bot_messages (
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id text NOT NULL,
  chat_id text,
  message_id bigint,
  direction text,
  update_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  entry jsonb NOT NULL,           -- the full BotMessageEntry, unchanged shape
  PRIMARY KEY (user_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS moliya_bot_messages_tg_key
  ON public.moliya_bot_messages (user_id, chat_id, message_id, direction)
  WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS moliya_bot_messages_user_time
  ON public.moliya_bot_messages (user_id, created_at, message_id);
-- Server only (service role). Browser roles have no access.
ALTER TABLE public.moliya_bot_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moliya_bot_messages FROM PUBLIC,anon,authenticated;

-- Insert or merge one entry exactly like the old logBotMessage did: match by
-- update_id, else by (chat_id, message_id, direction); keep old text/caption/type
-- when the new value is empty; merge metadata. Keeps the newest 500 per user and
-- raises onboarding.last_message_id. One round trip instead of read + rewrite.
CREATE OR REPLACE FUNCTION public.moliya_log_bot_message(p_user_id text, p_entry jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_msg bigint := nullif(coalesce(p_entry->>'message_id', p_entry->>'messageId'),'')::bigint;
  v_upd bigint := nullif(p_entry->>'update_id','')::bigint;
  v_chat text := p_entry->>'chat_id';
  v_dir text := p_entry->>'direction';
  v_at timestamptz := coalesce(nullif(p_entry->>'timestamp','')::timestamptz, now());
  v_old public.moliya_bot_messages%ROWTYPE;
  v_new jsonb;
BEGIN
  IF p_user_id IS NULL OR p_entry IS NULL OR coalesce(p_entry->>'id','') = '' THEN RETURN; END IF;
  SELECT * INTO v_old FROM public.moliya_bot_messages
   WHERE user_id = p_user_id
     AND ((v_upd IS NOT NULL AND update_id = v_upd)
       OR (v_msg IS NOT NULL AND message_id = v_msg AND direction IS NOT DISTINCT FROM v_dir
           AND chat_id IS NOT DISTINCT FROM v_chat)
       OR id = p_entry->>'id')
   ORDER BY (update_id IS NOT DISTINCT FROM v_upd) DESC
   LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_new := v_old.entry || p_entry
      || jsonb_build_object('metadata', coalesce(v_old.entry->'metadata','{}'::jsonb) || coalesce(p_entry->'metadata','{}'::jsonb));
    IF coalesce(p_entry->>'text','') = '' AND v_old.entry ? 'text' THEN v_new := v_new || jsonb_build_object('text', v_old.entry->'text'); END IF;
    IF coalesce(p_entry->>'caption','') = '' AND v_old.entry ? 'caption' THEN v_new := v_new || jsonb_build_object('caption', v_old.entry->'caption'); END IF;
    IF coalesce(p_entry->>'type','') = '' AND v_old.entry ? 'type' THEN v_new := v_new || jsonb_build_object('type', v_old.entry->'type'); END IF;
    UPDATE public.moliya_bot_messages
       SET entry = v_new, update_id = coalesce(update_id, v_upd)
     WHERE user_id = p_user_id AND id = v_old.id;
  ELSE
    INSERT INTO public.moliya_bot_messages (user_id, id, chat_id, message_id, direction, update_id, created_at, entry)
    VALUES (p_user_id, p_entry->>'id', v_chat, v_msg, v_dir, v_upd, v_at, p_entry)
    ON CONFLICT (user_id, id) DO UPDATE SET entry = public.moliya_bot_messages.entry || EXCLUDED.entry;
    DELETE FROM public.moliya_bot_messages
     WHERE user_id = p_user_id AND id IN (
       SELECT id FROM public.moliya_bot_messages WHERE user_id = p_user_id
       ORDER BY created_at DESC, message_id DESC NULLS LAST OFFSET 500);
  END IF;
  IF v_msg IS NOT NULL THEN
    UPDATE public.users
       SET onboarding = jsonb_set(coalesce(onboarding,'{}'::jsonb), '{last_message_id}', to_jsonb(v_msg))
     WHERE id = p_user_id AND coalesce(nullif(onboarding->>'last_message_id','')::bigint, 0) < v_msg;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.moliya_log_bot_message(text, jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moliya_log_bot_message(text, jsonb) TO service_role;
COMMIT;
