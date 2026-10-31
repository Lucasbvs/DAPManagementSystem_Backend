import { notifyInventoryChanged } from "../services/inventoryEvents.service.js";
import type { RequestHandler } from "express";
import * as service from "../services/inventario.service.js";
import { vestidoSchema, idSchema } from "../validators/vestido.schema.js";
import { ok } from "../utils/response.js";
export const list: RequestHandler = async (_req, res) => {
  ok(res, await service.list());
};
export const create: RequestHandler = async (req, res) => {
  const data = await service.create(vestidoSchema.parse(req.body));
  notifyInventoryChanged();
  ok(res, data, 201);
};
export const update: RequestHandler = async (req, res) => {
  const data = await service.update(
    idSchema.parse(req.params.id),
    vestidoSchema.parse(req.body),
  );
  notifyInventoryChanged();
  ok(res, data);
};
export const remove: RequestHandler = async (req, res) => {
  const data = await service.remove(idSchema.parse(req.params.id));
  notifyInventoryChanged();
  ok(res, data);
};
export const owners: RequestHandler = async (_req, res) => {
  ok(res, await service.owners());
};
