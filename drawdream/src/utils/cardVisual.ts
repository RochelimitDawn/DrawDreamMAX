const gradients = [
  'linear-gradient(145deg, #0f172a 0%, #1d4ed8 45%, #60a5fa 100%)',
  'linear-gradient(145deg, #111827 0%, #7c3aed 50%, #f472b6 100%)',
  'linear-gradient(145deg, #0b1324 0%, #0ea5e9 48%, #a7f3d0 100%)',
  'linear-gradient(145deg, #1f2937 0%, #f59e0b 45%, #fde68a 100%)',
  'linear-gradient(145deg, #111827 0%, #ef4444 48%, #fb7185 100%)',
  'linear-gradient(145deg, #0f172a 0%, #14b8a6 50%, #99f6e4 100%)',
  'linear-gradient(145deg, #1e1b4b 0%, #6366f1 48%, #c4b5fd 100%)',
  'linear-gradient(145deg, #0c0a09 0%, #ea580c 50%, #fdba74 100%)',
]

const accents = ['#60a5fa', '#f472b6', '#a7f3d0', '#fde68a', '#fb7185', '#99f6e4', '#c4b5fd', '#fdba74']

export function cardGradient(index: number): string {
  return gradients[index % gradients.length]
}

export function cardAccent(index: number): string {
  return accents[index % accents.length]
}
