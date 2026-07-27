import { formatDayShortBA, formatTimeBA } from '@/db/queries';
import { cn } from '@/lib/cn';
import { Caps } from './ui';

// DayTimeChip — the "DÍA · HORA" mono chip that leads each row of the
// Próximamente text index. Day in ink-gray, dot separator, time in carmine
// (indie) or ink (chain). Owns the BA-timezone formatting so callers pass a
// raw Date.
export function DayTimeChip({
  date,
  isIndie = false,
  className,
}: {
  date: Date;
  isIndie?: boolean;
  className?: string;
}) {
  return (
    <Caps as="div" className={cn('whitespace-nowrap', className)}>
      <span className="text-ink-gray">{formatDayShortBA(date)}</span>
      <span className="text-ink-gray/60 mx-1">·</span>
      <span className={isIndie ? 'text-carmine font-bold' : 'text-ink'}>
        {formatTimeBA(date)}
      </span>
    </Caps>
  );
}
