import { Router } from "express";
import u from "@/utils";
import { requireAdmin } from "@/lib/auth";
import { success } from "@/lib/responseFormat";

const router = Router();

export default router.get("/", requireAdmin, async (req, res) => {
  res.set("Cache-Control", "no-store").json(success({ users: await u.users.listUsers() }));
});
