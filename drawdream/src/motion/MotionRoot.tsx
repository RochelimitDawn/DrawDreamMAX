import { useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { easeOut, gsap, prefersReducedMotion, registerMotion, ScrollTrigger, useGSAP } from './setup'

/** Registers plugins once and plays a soft page entrance on route change. */
export function MotionRoot({ children }: { children: ReactNode }) {
  const location = useLocation()
  const mainRef = useRef<HTMLDivElement>(null)
  registerMotion()

  useGSAP(
    () => {
      const el = mainRef.current
      if (!el) return
      if (prefersReducedMotion()) {
        gsap.set(el, { autoAlpha: 1, y: 0 })
        return
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0.35, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.45,
          ease: easeOut,
          onComplete: () => {
            ScrollTrigger.refresh()
          },
        },
      )
      requestAnimationFrame(() => ScrollTrigger.refresh())
    },
    { dependencies: [location.pathname] },
  )

  return (
    <div ref={mainRef} className="dd-motion-root">
      {children}
    </div>
  )
}