import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({ id: z.string().uuid() }, "body"), async (req, res) => {
  const canceled = u.mediaGeneration.cancelMediaGeneration(req.body.id);
  if (!canceled) return res.status(404).json(error("生成任务不存在或已结束", null, 404));
  res.json(success());
});
