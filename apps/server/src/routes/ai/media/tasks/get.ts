import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

export default Router().get("/", validateFields({ id: z.string().uuid() }, "query"), (req, res) => {
  const job = u.mediaGeneration.getMediaGeneration(String(req.query.id));
  if (!job) return res.status(404).json(error("生成任务不存在或已过期", null, 404));
  res.json(success({ status: job.status, result: job.result, error: job.error }));
});
