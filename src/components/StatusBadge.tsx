const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  expired: "bg-zinc-200 text-zinc-600",
  deleted: "bg-zinc-200 text-zinc-600",
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export function StatusBadge({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        STATUS_STYLES[label] ?? "bg-zinc-100 text-zinc-600"
      }`}
    >
      {label}
    </span>
  );
}
