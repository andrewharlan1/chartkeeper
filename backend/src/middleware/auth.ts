import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq, and } from 'drizzle-orm';
import { dz } from '../db';
import { users, workspaceMembers } from '../schema';

export interface AuthPayload {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      /** The real authenticated user id (differs from user.id during impersonation) */
      realUserId?: string;
      /** True when the request is being handled as an impersonated user */
      isImpersonating?: boolean;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    req.user = payload;
    req.realUserId = payload.id;
    req.isImpersonating = false;

    // Handle impersonation
    const impersonateId = req.headers['x-impersonate-user-id'] as string | undefined;
    if (impersonateId) {
      resolveImpersonation(req, res, next, payload.id, impersonateId);
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function resolveImpersonation(
  req: Request, res: Response, next: NextFunction,
  realUserId: string, targetUserId: string,
): Promise<void> {
  try {
    // Look up the target user
    const [target] = await dz.select({ id: users.id, email: users.email, isDummy: users.isDummy })
      .from(users).where(eq(users.id, targetUserId));

    if (!target) {
      res.status(400).json({ error: 'Impersonation target user not found' });
      return;
    }

    // Verify the real user is an owner/admin in at least one workspace the target belongs to
    const sharedWorkspaces = await dz.select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.userId, realUserId),
      ));

    const isAdmin = sharedWorkspaces.some(w => w.role === 'owner' || w.role === 'admin');
    if (!isAdmin) {
      res.status(403).json({ error: 'Only workspace owners/admins can impersonate' });
      return;
    }

    // Swap the effective user
    req.user = { id: target.id, email: target.email };
    req.isImpersonating = true;
    next();
  } catch {
    res.status(500).json({ error: 'Impersonation failed' });
  }
}
