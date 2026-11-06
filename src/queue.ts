export class KeyedSerialQueue {
  private tails=new Map<string,Promise<void>>();
  private counts=new Map<string,number>();
  private readonly maxPerKey:number;
  constructor(maxPerKey=25){this.maxPerKey=maxPerKey;}

  enqueue<T>(key:string,task:()=>Promise<T>):Promise<T> {
    const count=this.counts.get(key)??0;
    if(count>=this.maxPerKey)return Promise.reject(new Error("Hàng đợi của nhóm đang đầy"));
    this.counts.set(key,count+1);
    const previous=this.tails.get(key)??Promise.resolve();
    const run=previous.catch(()=>undefined).then(task);
    const tail=run.then(()=>undefined,()=>undefined).finally(()=>{
      const next=(this.counts.get(key)??1)-1;
      if(next<=0){this.counts.delete(key);if(this.tails.get(key)===tail)this.tails.delete(key);}
      else this.counts.set(key,next);
    });
    this.tails.set(key,tail);
    return run;
  }
  pending(key:string){return this.counts.get(key)??0;}
}
