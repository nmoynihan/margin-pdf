import type { ButtonHTMLAttributes, ComponentType } from 'react'

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
    <span className={`brand-mark${small ? ' small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 36 36" fill="none">
        <path
          d="M10 7h11l6 6v16H10V7Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M21 7v7h6M14 19h9M14 23h7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M6 11v21h17"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          opacity=".55"
        />
      </svg>
    </span>
  )
}
