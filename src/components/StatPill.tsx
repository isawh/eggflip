interface StatPillProps {
  icon: string;
  label: string;
  value: string;
}

export function StatPill({ icon, label, value }: StatPillProps) {
  return (
    <div className="stat-pill">
      <span className="stat-icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="stat-label">{label}</span>
        <strong>{value}</strong>
      </span>
    </div>
  );
}
