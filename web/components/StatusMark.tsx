type Status = 'scheduled' | 'completed' | 'cancelled' | 'busy';

const configs: Record<Status, { label: string; className: string }> = {
  scheduled: { label: 'SCHEDULED', className: 'status-scheduled' },
  completed: { label: 'COMPLETED', className: 'status-completed' },
  cancelled: { label: 'CANCELLED', className: 'status-cancelled' },
  busy: { label: 'OCCUPIED', className: 'status-busy' }
};

export function StatusMark({ status }: { status: Status }) {
  const config = configs[status];
  return (
    <span className={`status-badge ${config.className}`}>
      <span>{config.label}</span>
    </span>
  );
}
