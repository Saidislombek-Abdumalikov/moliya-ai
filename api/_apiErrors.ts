// Public financial failure codes are an explicit contract, never raw SQL/provider errors.
const financialErrors:Record<string,number>={
 INVALID_SESSION:401, SESSION_EXPIRED:401,
 ACCOUNT_RESTRICTED:403, BOT_VERIFICATION_REQUIRED:403,
 FINANCIAL_CONFLICT:409, USER_NOT_FOUND:404,
 INVALID_TRANSACTIONS:400, INVALID_TRANSACTION_ID:400, INVALID_FINANCIAL_ACTION:400,
 EXPECTED_CARDS_REQUIRED:400, EXPECTED_FINANCIAL_STATE_REQUIRED:400,
 INVALID_CARD_OPERATION:400, INVALID_CARD_ID:400, INVALID_ADJUSTMENT:400,
 FINANCIAL_STORE_UNAVAILABLE:503
};
export function publicFinancialError(error:unknown):{statusCode:number;error:string}{
 const message=(error as {message?:unknown})?.message;
 if(typeof message==='string' && Object.hasOwn(financialErrors,message))return {statusCode:financialErrors[message],error:message};
 return {statusCode:500,error:'FINANCIAL_WRITE_FAILED'};
}
