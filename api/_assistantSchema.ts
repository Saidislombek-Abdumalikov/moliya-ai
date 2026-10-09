// The provider must return transaction fields, not only an acknowledgment.
const string={type:'string'};
const optionalString={type:['string','null']};
export const assistantResponseSchema={
 type:'object',
 properties:{
  intent:{type:'string',enum:['transaction','answer','clarification']},
  transcription:{...string,description:'Full literal audio transcript; preserve all amounts. Empty for typed input.'},
  message:{...string,description:'Only a read-only answer to an actual question. Empty for transactions. Never claim saved.'},
  question:{...string,description:'A short clarification in the selected user language, or empty.'},
  clarification:{type:'string',enum:['none','multiple','amount','kind','audio','account','person','date','time','currency']},
  actions:{type:'array',items:{type:'object',properties:{
   group:{...string,description:'Same nonempty identifier only for priced parts of one event.'},
   account:{...string,description:'cash, card:<exact user card id>, or unknown'},
   amountEvidence:{...string,description:'Verbatim amount phrase from the input, including ming/million scale.'},
   kind:{type:'string',enum:['expense','income','debt','lending','payment','repayment']},
   amount:{type:['number','null']},currency:string,title:string,note:string,time:optionalString,
   icon:{type:'string',enum:['wifi','phone','home','utilities','transport','education','health','subscription','other']},
   category:string,date:optionalString,person:string,dueDate:optionalString,dueUnknown:{type:'boolean'},
   repeat:{type:'string',enum:['none','weekly','monthly']},debtId:string
  },required:['group','account','amountEvidence','kind','amount','currency','title','note','time','icon','category','date','person','dueDate','dueUnknown','repeat','debtId']}}
 },required:['intent','transcription','message','question','clarification','actions']
};
