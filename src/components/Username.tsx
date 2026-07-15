// Renders a username; admins get bold, animated blue gradient text.
export default function Username({
  name,
  isAdmin = false,
  className = "",
}: {
  name: string;
  isAdmin?: boolean;
  className?: string;
}) {
  if (isAdmin) {
    return <span className={`admin-name font-bold ${className}`}>{name}</span>;
  }
  return <span className={className}>{name}</span>;
}
