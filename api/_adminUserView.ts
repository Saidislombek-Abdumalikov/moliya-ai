import {effectiveTrialEnd} from '../shared/registrationTrial.js';
import {effectiveAccess} from './_accessHelper.js';
import {accountDenied,eligibleUser,verifiedPhone,acceptedConsent,publicOnboarding} from './_userPolicy.js';
import {financialTotals} from '../shared/financialTotals.js';

// Same server policies as user auth; no browser inference from a phone number.
export function adminUserView(u:any,restricted=false,defaultAiQuota=20){
 const denied=restricted || accountDenied(u);
 const phoneVerified=verifiedPhone(u),consentAccepted=acceptedConsent(u);
 const verified=!denied && eligibleUser(u);
 const entitlement=effectiveAccess(u,defaultAiQuota);
 const access=denied?{...entitlement,level:'BLOCKED',label:'Bloklangan',canUseApp:false,canUseAi:false,isPremium:false,aiLimit:0}:
   {...entitlement,canUseApp:verified,canUseAi:verified && entitlement.canUseAi};
 const deleted=Boolean(u.is_deleted || u.onboarding?.is_deleted || u.account_status==='deleted');
 const transactions=Array.isArray(u.transactions) && u.transactions.length ? u.transactions :
   Array.isArray(u.onboarding?.transactions)?u.onboarding.transactions:[];
 const financialSummary=financialTotals(transactions);
 const today=new Date().toISOString().slice(0,10);
 const todaySummary=financialTotals(transactions.filter((tx:any)=>String(tx?.date||'').slice(0,10)===today));
 return {
  id:u.id,name:u.name,phone:u.phone,telegram:u.telegram,telegramId:String(u.telegram_id),
  isPremium:access.isPremium,premiumExpiresAt:u.premium_expires_at,trialEndsAt:effectiveTrialEnd(u),
  isBlocked:denied,isRestricted:restricted || Boolean(u.is_restricted || u.onboarding?.is_restricted || u.device_info?.restricted),isDeleted:deleted,
  unlimitedAi:Boolean(u.unlimited_ai),aiBlocked:Boolean(u.ai_blocked || u.onboarding?.ai_blocked),
  language:u.language,aiLimit:access.aiLimit,aiQueryCount:u.ai_query_count||0,lastAiQueryAt:u.last_ai_query_at,
  platform:u.platform,createdAt:u.created_at,updatedAt:u.updated_at,
  phoneVerified,consentAccepted,isVerified:verified,
  consentAcceptedAt:consentAccepted?u.bot_verification.consent_accepted_at:null,
  consentVersion:consentAccepted?u.bot_verification.consent_version:null,
  effectiveAccess:access,accountStatus:deleted?'deleted':denied?'blocked':!phoneVerified?'pending_phone':!consentAccepted?'pending_consent':'active',
  onboarding:publicOnboarding(u),
  cards:Array.isArray(u.cards)?u.cards:[],transactions,financialSummary,todaySummary
 };
}
