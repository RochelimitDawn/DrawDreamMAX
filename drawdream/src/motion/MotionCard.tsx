import { useRef, type ReactNode, type CSSProperties } from 'react'
import { easeOut, gsap, prefersReducedMotion, useGSAP } from './setup'

interface MotionCardProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  as?: 'article' | 'div' | 'li'
  tilt?: boolean
  maxTilt?: number
  lift?: number
  reveal?: boolean
  delay?: number
}

export function MotionCard({
  children,
  className = '',
  style,
  as: Tag = 'article',
  tilt = true,
  maxTilt = 7,
  lift = 6,
  reveal = true,
  delay = 0,
}: MotionCardProps) {
  const ref = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return

      if (prefersReducedMotion()) {
        gsap.set(el, { autoAlpha: 1 })
        return
      }

      if (reveal) {
        gsap.fromTo(
          el,
          { y: 40, autoAlpha: 0, scale: 0.96 },
          {
            y: 0,
            autoAlpha: 1,
            scale: 1,
            duration: 0.7,
            delay,
            ease: easeOut,
            scrollTrigger: {
              trigger: el,
              start: 'top 92%',
              once: true,
            },
          },
        )
      }

      if (!tilt) return

      const onMove = (e: MouseEvent) => {
        const rect = el.getBoundingClientRect()
        const px = (e.clientX - rect.left) / rect.width - 0.5
        const py = (e.clientY - rect.top) / rect.height - 0.5
        gsap.to(el, {
          rotateY: px * maxTilt * 2,
          rotateX: -py * maxTilt * 2,
          y: -lift,
          transformPerspective: 900,
          transformOrigin: 'center',
          duration: 0.35,
          ease: easeOut,
          overwrite: 'auto',
        })
      }

      const onLeave = () => {
        gsap.to(el, {
          rotateX: 0,
          rotateY: 0,
          y: 0,
          duration: 0.7,
          ease: 'elastic.out(1, 0.5)',
          overwrite: 'auto',
        })
      }

      el.addEventListener('mousemove', onMove)
      el.addEventListener('mouseleave', onLeave)
      return () => {
        el.removeEventListener('mousemove', onMove)
        el.removeEventListener('mouseleave', onLeave)
      }
    },
    { dependencies: [tilt, maxTilt, lift, reveal, delay], revertOnUpdate: true },
  )

  return (
    <Tag
      ref={ref as never}
      className={`dd-motion-card ${className}`.trim()}
      style={{ ...style, transformStyle: 'preserve-3d' }}
    >
      {children}
    </Tag>
  )
}
