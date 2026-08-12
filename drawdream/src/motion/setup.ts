import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { shouldReduceMotion, shouldSimplifyMotion } from '../utils/deviceProfile'

let registered = false

export function registerMotion() {
  if (registered || typeof window === 'undefined') return
  gsap.registerPlugin(useGSAP, ScrollTrigger)
  gsap.config({ nullTargetWarn: false })
  registered = true
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  // 低端机：关闭动画保证交互流畅
  return shouldReduceMotion()
}

/** 中低端机希望简化（非禁用）动画时的判断。 */
export function prefersSimplifiedMotion() {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  return shouldSimplifyMotion()
}

export const easeOut = 'power3.out'
export const easeSoft = 'power2.out'
export const easeExpo = 'expo.out'

export { gsap, useGSAP, ScrollTrigger }
