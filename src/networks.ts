// Redes sociales permitidas y su ícono de Font Awesome 6.5 (el mismo que carga la plantilla).

export const NETWORKS = {
  facebook: { label: 'Facebook', icon: 'fa-brands fa-facebook' },
  instagram: { label: 'Instagram', icon: 'fa-brands fa-instagram' },
  tiktok: { label: 'TikTok', icon: 'fa-brands fa-tiktok' },
  youtube: { label: 'YouTube', icon: 'fa-brands fa-youtube' },
  whatsapp: { label: 'WhatsApp', icon: 'fa-brands fa-whatsapp' },
  x: { label: 'X (Twitter)', icon: 'fa-brands fa-x-twitter' },
  linkedin: { label: 'LinkedIn', icon: 'fa-brands fa-linkedin' },
  tripadvisor: { label: 'Tripadvisor', icon: 'fa-solid fa-star-half-stroke' }, // Font Awesome libre ya no trae el logo
  pinterest: { label: 'Pinterest', icon: 'fa-brands fa-pinterest' },
  spotify: { label: 'Spotify', icon: 'fa-brands fa-spotify' },
  web: { label: 'Sitio web', icon: 'fa-solid fa-globe' },
  email: { label: 'Correo', icon: 'fa-solid fa-envelope' },
} as const;

export type Network = keyof typeof NETWORKS;

export const NETWORK_KEYS = Object.keys(NETWORKS) as [Network, ...Network[]];
