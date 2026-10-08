import { createMiddleware } from "@tanstack/react-start";

import { isAdminSessionValid, requireAdminSession } from "./admin-session.server";

export const requireAdminMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    await requireAdminSession();
    return next();
  },
);

export const optionalAdminMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    return next({
      context: {
        isAdmin: await isAdminSessionValid(),
      },
    });
  },
);
