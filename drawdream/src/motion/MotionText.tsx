import { useRef, type ReactNode } from 'react'
import { easeExpo, easeOut, gsap, prefersReducedMotion, useGSAP } from './setup'
import { splitElement, type SplitMode } from './split'

interface MotionTextProps {
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div'
  children: ReactNode
  className?: string
  mode?: SplitMode
  delay?: number
  stagger?: number
  y?: number
  once?: boolean
}

export function MotionText({
  as: Tag = 'span',
  children,
  className = '',
  mode = 'chars',
  delay = 0,
  stagger = 0.028,
  y = 28,
  once = true,
}: MotionTextProps) {
  const ref = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return

      if (prefersReducedMotion()) {
        gsap.set(el, { autoAlpha: 1 })
        return
      }

      const split = splitElement(el, mode)
      const targets = mode === 'words' ? split.words : split.chars
      if (!targets.length) {
        gsap.fromTo(el, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: easeOut, delay })
        return () => split.revert()
      }

      gsap.set(el, { autoAlpha: 1 })
      gsap.fromTo(
        targets,
        { y, autoAlpha: 0, rotateX: 40, transformOrigin: '50% 100%' },
        {
          y: 0,
          autoAlpha: 1,
          rotateX: 0,
          duration: 0.85,
          ease: easeExpo,
          stagger,
          delay,
          scrollTrigger: once
            ? {
                trigger: el,
                start: 'top 90%',
                once: true,
              }
            : undefined,
        },
      )

      return () => split.revert()
    },
    { dependencies: [children, mode, delay, stagger, y, once], revertOnUpdate: true },
  )

  return (
    <Tag ref={ref as never} className={`dd-motion-text ${className}`.trim()} style={{ perspective: 600 }}>
      {children}
    </Tag>
  )
}