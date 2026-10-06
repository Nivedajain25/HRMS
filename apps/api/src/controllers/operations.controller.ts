import type { Request, Response } from 'express';
import { logger } from '../config/logger';
import { getCtx } from '../middleware/auth';
import { safeFileName } from '../middleware/upload';
import { body, query } from '../middleware/validate';
import * as assets from '../services/asset.service';
import * as documents from '../services/document.service';
import * as expenses from '../services/expense.service';
import * as offboarding from '../services/offboarding.service';
import { handle, handleCreated, handlePaged, idOf } from '../utils/controller';

type Q = Parameters<typeof documents.listDocuments>[1];

export const fileController = {
  upload: handleCreated((ctx, req) => documents.uploadFile(ctx, req.file, body(req)), 'File uploaded'),
  /** Streams a stored file after authorization; never exposes storage keys or public URLs. */
  download: async (req: Request, res: Response) => {
    const ctx = getCtx(req);
    const { inline } = query<{ inline?: boolean }>(req) ?? {};
    const { doc, stream, inlineAllowed } = await documents.openFile(ctx, idOf(req));
    const disposition = inline && inlineAllowed ? 'inline' : 'attachment';
    res.status(200);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.size));
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeFileName(doc.originalName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    stream.on('error', (err) => {
      logger.error({ err, documentId: String(doc._id) }, 'File stream failed');
      res.destroy(err);
    });
    stream.pipe(res);
  },
  uploadPhoto: handle((ctx, req) => documents.uploadEmployeePhoto(ctx, idOf(req), req.file), 'Photo updated'),
};

export const documentController = {
  list: handlePaged((ctx, req) => documents.listDocuments(ctx, query<Q>(req))),
  expiring: handle((ctx, req) => documents.expiringDocuments(ctx, query(req))),
  get: handle((ctx, req) => documents.getDocument(ctx, idOf(req))),
  versions: handle((ctx, req) => documents.listVersions(ctx, idOf(req))),
  upload: handleCreated((ctx, req) => documents.uploadDocument(ctx, req.file, body(req)), 'Document uploaded'),
  verify: handle((ctx, req) => documents.verifyDocument(ctx, idOf(req), body(req)), 'Document updated'),
  remove: handle((ctx, req) => documents.deleteDocument(ctx, idOf(req)), 'Document deleted'),
};

export const assetController = {
  list: handlePaged((ctx, req) => assets.listAssets(ctx, query(req))),
  mine: handle((ctx) => assets.myAssets(ctx)),
  summary: handle((ctx) => assets.assetSummary(ctx)),
  assignments: handlePaged((ctx, req) => assets.listAssignments(ctx, query(req))),
  get: handle((ctx, req) => assets.getAsset(ctx, idOf(req))),
  create: handleCreated((ctx, req) => assets.createAsset(ctx, body(req)), 'Asset created'),
  update: handle((ctx, req) => assets.updateAsset(ctx, idOf(req), body(req)), 'Asset updated'),
  assign: handle((ctx, req) => assets.assignAsset(ctx, idOf(req), body(req)), 'Asset assigned'),
  return: handle((ctx, req) => assets.returnAsset(ctx, idOf(req), body(req)), 'Asset returned'),
  status: handle((ctx, req) => assets.changeAssetStatus(ctx, idOf(req), body(req)), 'Asset status updated'),
  remove: handle((ctx, req) => assets.deleteAsset(ctx, idOf(req)), 'Asset deleted'),
};

export const expenseController = {
  list: handlePaged((ctx, req) => expenses.listExpenses(ctx, query(req))),
  summary: handle((ctx, req) => expenses.expenseSummary(ctx, query(req))),
  get: handle((ctx, req) => expenses.getExpense(ctx, idOf(req))),
  create: handleCreated((ctx, req) => expenses.createExpense(ctx, body(req)), 'Expense saved'),
  update: handle((ctx, req) => expenses.updateExpense(ctx, idOf(req), body(req)), 'Expense updated'),
  submit: handle((ctx, req) => expenses.submitExpense(ctx, idOf(req)), 'Expense submitted'),
  approve: handle((ctx, req) => expenses.approveExpense(ctx, idOf(req), body<{ comment?: string }>(req).comment), 'Expense approved'),
  reject: handle((ctx, req) => expenses.rejectExpense(ctx, idOf(req), body<{ reason: string }>(req).reason), 'Expense rejected'),
  cancel: handle((ctx, req) => expenses.cancelExpense(ctx, idOf(req)), 'Expense cancelled'),
  pay: handle((ctx, req) => expenses.payExpense(ctx, idOf(req), body(req)), 'Expense marked as paid'),
};

export const offboardingController = {
  list: handlePaged((ctx, req) => offboarding.listOffboardings(ctx, query(req))),
  get: handle((ctx, req) => offboarding.getOffboarding(ctx, idOf(req))),
  create: handleCreated((ctx, req) => offboarding.createOffboarding(ctx, body(req)), 'Offboarding started'),
  advance: handle((ctx, req) => offboarding.advanceOffboarding(ctx, idOf(req), body(req)), 'Offboarding updated'),
  cancel: handle((ctx, req) => offboarding.cancelOffboarding(ctx, idOf(req), body<{ note?: string }>(req).note), 'Offboarding cancelled'),
};
