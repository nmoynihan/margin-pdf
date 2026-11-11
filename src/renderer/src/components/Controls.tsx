import type { ButtonHTMLAttributes, ComponentType, CSSProperties } from 'react'
import marginMark from '../../../../resources/branding/margin-pdf-mark.png'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>
export function IconButton({
  icon: Icon,
  label,
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-button${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      {...props}
    >
      <Icon size={17} strokeWidth={1.7} aria-hidden />
    </button>
  )
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`brand-mark${small ? ' small' : ''}`}
      aria-hidden="true"
      style={{ '--brand-image': `url("${marginMark}")` } as CSSProperties}
    >
      <span className="brand-glyph" />
    </span>
  )
}
