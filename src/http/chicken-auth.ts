import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { repository } from "../db.js";

const ISSUER = "mbalong-chicken-garage";

export interface ChickenAuthRequest extends Request {
  chickenAuth?: { zaloId: string; manageToken: string };
}

export function hashChickenPin(pin: string, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(pin, salt, 32).toString("hex") };
}

export function chickenPinMatches(pin: string, salt: string, expectedHex: string) {
  const actual = scryptSync(pin, salt, 32);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function issueChickenToken(zaloId: string, manageToken: string) {
  return jwt.sign({ sub: zaloId, manageToken, type: "chicken" }, config.JWT_SECRET, {
    expiresIn: "7d",
    issuer: ISSUER,
  });
}

export function setChickenCookie(res: Response, token: string) {
  res.cookie("chicken_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.PUBLIC_ORIGIN.startsWith("https://"),
    maxAge: 7 * 24 * 3600_000,
    path: "/",
  });
}

export function requireChickenSession(req: ChickenAuthRequest, res: Response, next: NextFunction) {
  const session = req.cookies?.chicken_session;
  if (!session) return res.status(401).json({ error: "Hãy nhập mã PIN để mở garage" });
  try {
    const claim = jwt.verify(session, config.JWT_SECRET, { issuer: ISSUER }) as {
      sub?: string; manageToken?: string; type?: string;
    };
    const routeToken = String(req.params.token ?? "");
    if (claim.type !== "chicken" || !claim.sub || claim.manageToken !== routeToken)
      return res.status(401).json({ error: "Phiên garage không hợp lệ" });
    const profile = repository.chickenWebProfileByToken(routeToken);
    if (!profile || profile.zalo_id !== claim.sub)
      return res.status(401).json({ error: "Liên kết garage không còn hiệu lực" });
    req.chickenAuth = { zaloId: claim.sub, manageToken: routeToken };
    next();
  } catch {
    return res.status(401).json({ error: "Phiên garage đã hết hạn" });
  }
}
