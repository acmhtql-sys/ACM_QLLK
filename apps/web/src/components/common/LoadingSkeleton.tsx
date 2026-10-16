import React from 'react';

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="animate-pulse rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="h-10 w-10 rounded-lg bg-slate-200" />
          </div>
          <div className="mt-4 h-7 w-20 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-32 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({
  rows = 5,
  columns = 8,
}) => {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="h-8 w-48 rounded bg-slate-200" />
        <div className="h-8 w-32 rounded bg-slate-100" />
      </div>
      <div className="space-y-3">
        <div className="h-9 w-full rounded bg-slate-100" />
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div key={rIdx} className="flex space-x-3">
            {Array.from({ length: columns }).map((_, cIdx) => (
              <div key={cIdx} className="h-8 flex-1 rounded bg-slate-50" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return <TableSkeleton rows={rows} />;
};
