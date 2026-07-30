import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { easeOut, gsap, prefersReducedMotion, useGSAP } from './setup'

type Common = {
  children: ReactNode
  className?: string
  magnetic?: boolean
  strength?: number
  shine?: boolean
}

type AsButton = Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    as?: 'button'
    to?: never
  }

type AsLink = Common &
  Omit<LinkProps, 'className' | 'children'> & {
    as: 'link'
    to: string
  }

type Props = AsButton | AsLink

export const MagneticButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  function MagneticButton(props, forwardedRef) {
    const {
      children,
      className = '',
      magnetic = true,
      strength = 0.35,
      shine = true,
      as = 'button',
      ...rest
    } = props

    const localRef = useRef<HTMLElement | null>(null)

    const setRefs = (node: HTMLElement | null) => {
      localRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node as never)
      else if (forwardedRef) (forwardedRef as { current: HTMLElement | null }).current = node
    }

    useGSAP(() => {
      const el = localRef.current
      if (!el || prefersReducedMotion() || !magnetic) return

      const onMove = (e: globalThis.MouseEvent) => {
        const rect = el.getBoundingClientRect()
        const x = e.clientX - rect.left - rect.width / 2
        const y = e.clientY - rect.top - rect.height / 2
        gsap.to(el, {
          x: x * strength,
          y: y * strength,
          duration: 0.45,
          ease: easeOut,
          overwrite: 'auto',
        })
      }

      const onLeave = () => {
        gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, 0.45)', overwrite: 'auto' })
      }

      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', onLeave)
      return () => {
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseleave', onLeave)
      }
    }, { dependencies: [magnetic, strength] })

    const onClickRipple = (e: MouseEvent<HTMLElement>) => {
      const el = localRef.current
      if (!el || prefersReducedMotion()) return
      const rect = el.getBoundingClientRect()
      const ripple = document.createElement('span')
      ripple.className = 'dd-btn-ripple'
      const size = Math.max(rect.width, rect.height)
      ripple.style.width = `${size}px`
      ripple.style.height = `${size}px`
      ripple.style.left = `${e.clientX - rect.left - size / 2}px`
      ripple.style.top = `${e.clientY - rect.top - size / 2}px`
      el.appendChild(ripple)
      gsap.fromTo(
        ripple,
        { scale: 0, opacity: 0.35 },
        {
          scale: 1.6,
          opacity: 0,
          duration: 0.55,
          ease: easeOut,
          onComplete: () => ripple.remove(),
        },
      )
    }

    const cls = `dd-magnetic-btn ${shine ? 'has-shine' : ''} ${className}`.trim()

    if (as === 'link') {
      const linkRest = rest as Omit<AsLink, keyof Common | 'as'>
      return (
        <Link
          {...linkRest}
          ref={setRefs as never}
          className={cls}
          onClick={(e) => {
            onClickRipple(e)
            linkRest.onClick?.(e)
          }}
        >
          <span className="dd-magnetic-label">{children}</span>
        </Link>
      )
    }

    const btnRest = rest as Omit<AsButton, keyof Common | 'as'>
    return (
      <button
        type="button"
        {...btnRest}
        ref={setRefs as never}
        className={cls}
        onClick={(e) => {
          onClickRipple(e)
          btnRest.onClick?.(e)
        }}
      >
        <span className="dd-magnetic-label">{children}</span>
      </button>
    )
  },
)
