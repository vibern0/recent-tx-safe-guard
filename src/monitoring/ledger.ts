import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import type { ActivityAlert } from "./notifier";
export type ActivityLogKey=Readonly<{chainId:number;blockHash:Hex;transactionHash:Hex;logIndex:number}>;
export type LedgerCursor=Readonly<{blockNumber:bigint;blockHash:Hex;logIndex:number}>;
export type LedgerState={cursor?:LedgerCursor;records:Record<string,ActivityAlert>};
export interface ActivityStore{load():LedgerState;save(state:LedgerState):void;}
export class InMemoryActivityStore implements ActivityStore{private state:LedgerState={records:{}};load(){return this.state;}save(s:LedgerState){this.state=s;}}
export class FileActivityStore implements ActivityStore{constructor(private readonly path:string){}load():LedgerState{if(!existsSync(this.path))return{records:{}};const raw=JSON.parse(readFileSync(this.path,"utf8")) as{cursor?:{blockNumber:string;blockHash:Hex;logIndex:number};records:Record<string,ActivityAlert>};return{cursor:raw.cursor&&{blockNumber:BigInt(raw.cursor.blockNumber),blockHash:raw.cursor.blockHash,logIndex:raw.cursor.logIndex},records:raw.records??{}};}save(state:LedgerState):void{const tmp=`${this.path}.tmp`;writeFileSync(tmp,JSON.stringify(state,(_,v)=>typeof v==="bigint"?v.toString():v)+"\n",{flag:"w"});renameSync(tmp,this.path);}}
const id=(k:ActivityLogKey)=>`${k.chainId}:${k.transactionHash.toLowerCase()}:${k.logIndex}:${k.blockHash.toLowerCase()}`;
export class ActivityLedger{private state:LedgerState;constructor(private readonly store:ActivityStore){this.state=store.load();}cursor(){return this.state.cursor;}
 accept(k:ActivityLogKey,a:ActivityAlert):boolean{const n=id(k);if(this.state.records[n])return false;this.state.records[n]=a;const c=this.state.cursor;if(!c||a.blockNumber>c.blockNumber||(a.blockNumber===c.blockNumber&&k.logIndex>c.logIndex))this.state.cursor={blockNumber:a.blockNumber,blockHash:k.blockHash,logIndex:k.logIndex};this.store.save(this.state);return true;}
 remove(k:ActivityLogKey){const n=id(k),old=this.state.records[n];if(!old)return undefined;delete this.state.records[n];this.store.save(this.state);return old;}
 reconcileCanonical(chainId:number,canonical:(block:number)=>Hex|undefined):number{let removed=0;for(const [key,a]of Object.entries(this.state.records)){if(a.chainId!==chainId)continue;const hash=canonical(Number(a.blockNumber));if(hash&&hash.toLowerCase()!==key.slice(key.lastIndexOf(":")+1).toLowerCase()){delete this.state.records[key];removed++;}}if(removed)this.store.save(this.state);return removed;}
 records(){return Object.values(this.state.records);}}
