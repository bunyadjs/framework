import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { User } from "../models/user.ts";

export const usersRouter = Router();

usersRouter.get(
  "/users",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await User.get();
      res.json(users);
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.get(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const user = await User.find(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(user);
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.post(
  "/users",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, name } = req.body ?? {};
      if (typeof email !== "string" || typeof name !== "string") {
        res.status(400).json({ error: "email and name are required strings" });
        return;
      }
      const user = await User.create({ email, name });
      res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.patch(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const user = await User.find(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof body.email === "string") patch.email = body.email;
      if (typeof body.name === "string") patch.name = body.name;
      await user.update(patch);
      res.json(user);
    } catch (error) {
      next(error);
    }
  },
);

usersRouter.delete(
  "/users/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const user = await User.find(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      await user.delete();
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
