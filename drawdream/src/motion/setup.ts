import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

let registered = false

export function registerMotion() {
  if (registered || typeof window === 'undefined') return
  gsap.registerPlugin(useGSAP, ScrollTrigger)
  gsap.config({ nullTargetWarn: false })
  registered = true
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export const easeOut = 'power3.out'
export const easeSoft = 'power2.out'
export const easeExpo = 'expo.out'

export { gsap, useGSAP, ScrollTrigger }
