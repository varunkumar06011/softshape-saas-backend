export function generateSlug(restaurantName: string): string {
  const base = restaurantName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${base}-${suffix}`;
}

export function nameToInitials(name: string): string {
  return name.split(' ').map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2);
}
