import {describe,expect,it} from "vitest";
import {KeyedSerialQueue} from "./queue.js";

describe("KeyedSerialQueue",()=>{
  it("processes every message in the same group in FIFO order",async()=>{
    const queue=new KeyedSerialQueue(),done:number[]=[];
    await Promise.all([1,2,3].map((id)=>queue.enqueue("group-1",async()=>{await new Promise((resolve)=>setTimeout(resolve,2));done.push(id);}))); 
    expect(done).toEqual([1,2,3]);
  });
  it("allows different groups to progress independently",async()=>{
    const queue=new KeyedSerialQueue(),done:string[]=[];
    const slow=queue.enqueue("a",async()=>{await new Promise((resolve)=>setTimeout(resolve,20));done.push("a");});
    const fast=queue.enqueue("b",async()=>{done.push("b");});
    await Promise.all([slow,fast]);expect(done[0]).toBe("b");
  });
});
