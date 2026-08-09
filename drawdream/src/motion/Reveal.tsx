import { useRef, type HTMLAttributes, type ReactNode } from 'react'
import { easeOut, gsap, prefersReducedMotion, useGSAP } from './setup'

interface RevealProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
  as?: 'div' | 'section' | 'article' | 'header' | 'li'
  y?: number
  delay?: number
  duration?: number
  staggerChildren?: string
  once?: boolean
}

export function Reveal({
  children,
  className = '',
  style,
  as: Tag = 'div',
  y = 36,
  delay = 0,
  duration = 0.75,
  staggerChildren,
  once = true,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return

      if (prefersReducedMotion()) {
        gsap.set(el, { autoAlpha: 1, clearProps: 'transform' })
        return
      }

      const targets = staggerChildren ? el.querySelectorAll(staggerChildren) : el
      if (staggerChildren && (targets as NodeListOf<Element>).length === 0) return

      gsap.fromTo(
        targets,
        { y, autoAlpha: 0, scale: staggerChildren ? 0.96 : 1 },
        {
          y: 0,
          autoAlpha: 1,
          scale: 1,
          duration,
          delay,
          ease: easeOut,
          stagger: staggerChildren ? 0.06 : 0,
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            once,
          },
        },
      )
    },
    { dependencies: [y, delay, duration, staggerChildren, once], revertOnUpdate: true },
  )

  return (
    <Tag ref={ref as never} className={`dd-reveal ${className}`.trim()} style={style} {...rest}>
      {children}
    </Tag>
  )
}
