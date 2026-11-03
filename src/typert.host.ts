/**
 * Host typert manifest for the vscodeTools face (the strict descriptor the
 * typert-loader reads via the package's './typert' export). Wire codecs and
 * invocation descriptors live in ./typert.shared.ts so the client manifest
 * cannot drift from this one.
 */
import { z } from 'zod'
import {
  PKG,
  serviceModel,
  vscodeOpenInvocation,
  vscodeStatusInvocation,
  vscodeStopInvocation,
} from './typert.shared.js'

export const TYPERT = {
  package: PKG,
  face: 'host',
  schemas: [] as unknown[],
  invocations: [
    vscodeOpenInvocation,
    vscodeStatusInvocation,
    vscodeStopInvocation,
  ],
  model: {
    services: [serviceModel],
    events: [] as unknown[],
    objects: [] as unknown[],
  },
}
export default TYPERT
void z
