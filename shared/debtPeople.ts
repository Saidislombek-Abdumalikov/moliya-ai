export const debtRelationships = {friend:"Do‘st",family:"Oila",father:"Ota",mother:"Ona",colleague:"Hamkasb",bank:"Bank",other:"Boshqa"} as const;
export type DebtRelationship = keyof typeof debtRelationships;
export function debtPersonLabel(name?:string,relationship?:string){
 const label=debtRelationships[relationship as DebtRelationship];
 return (name?.trim() || 'Nomsiz')+(label?' — '+label:'');
}
