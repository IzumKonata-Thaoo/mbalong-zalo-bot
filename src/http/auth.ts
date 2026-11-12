import type { NextFunction,Request,Response } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export interface AuthRequest extends Request { admin?:{sub:string}; }
export function passwordMatches(value:string) {
  const a=Buffer.from(value),b=Buffer.from(config.ADMIN_PASSWORD);return a.length===b.length&&timingSafeEqual(a,b);
}
export function issueToken() { return jwt.sign({sub:"web-admin",role:"admin"},config.JWT_SECRET,{expiresIn:"12h",issuer:"zalo-ai-console"}); }
export function secureCookieForRequest(req:Request) {
  const origin=req.get("origin");
  if(origin){try{return new URL(origin).protocol==="https:";}catch{return false;}}
  return config.PUBLIC_ORIGIN.startsWith("https://");
}
export function requireAdmin(req:AuthRequest,res:Response,next:NextFunction) {
  const token=req.cookies?.admin_session;
  if(!token)return res.status(401).json({error:"Chưa đăng nhập"});
  try{req.admin=jwt.verify(token,config.JWT_SECRET,{issuer:"zalo-ai-console"}) as {sub:string};next();}
  catch{return res.status(401).json({error:"Phiên đăng nhập hết hạn"});}
}
export function sameOrigin(req:Request,res:Response,next:NextFunction) {
  if(["GET","HEAD","OPTIONS"].includes(req.method))return next();
  const origin=req.get("origin");if(origin&&!config.allowedOrigins.has(origin))return res.status(403).json({error:"Origin không hợp lệ"});next();
}
