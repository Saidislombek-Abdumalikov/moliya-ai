-- Run AFTER the code from migration 25 is deployed (the old code still appends
-- to onboarding.bot_messages until then). Removes the old in-row copies so
-- users rows shrink. History lives in public.moliya_bot_messages from now on.
UPDATE public.users SET onboarding = onboarding - 'bot_messages' WHERE onboarding ? 'bot_messages';
