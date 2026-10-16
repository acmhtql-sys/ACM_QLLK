import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../shared/response';
import { authenticate } from '../../middleware/auth';

export const borrowRouter = Router();

borrowRouter.get('/', authenticate, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const borrows = await prisma.borrowRequest.findMany({
      include: {
        borrower: { select: { fullName: true, email: true } },
        details: {
          include: { item: { select: { code: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mapped = borrows.map((b) => ({
      id: b.id,
      requestNumber: b.requestNumber,
      borrowerName: b.borrower.fullName,
      borrowerEmail: b.borrower.email,
      status: b.status,
      purpose: b.purpose,
      expectedBorrowDate: b.expectedBorrowDate.toISOString().slice(0, 10),
      expectedReturnDate: b.expectedReturnDate.toISOString().slice(0, 10),
      itemCount: b.details.length,
      notes: b.notes,
      details: b.details,
    }));

    return sendSuccess(res, mapped, 'Danh sách phiếu mượn từ Database');
  } catch (err) {
    next(err);
  }
});
