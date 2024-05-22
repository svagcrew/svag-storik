import type { StroikAnyPersistent } from '@/client'
import type { Express } from 'express'
import cloneDeep from 'lodash/cloneDeep.js'

type LikeRequest = Record<string, any>
type LikeResponse = Record<string, any>

export type StrorikServerGetStore = <T extends StroikAnyPersistent>(storik: StroikAnyPersistent) => T['defaultValue']
export type StrorikServerResetStore = <T extends StroikAnyPersistent>(
  storik: StroikAnyPersistent,
  value: T['defaultValue']
) => any
export type ExpressRequestWithStorik = {
  getStorikStore: StrorikServerGetStore
}
export type ExpressResponseWithStorik = {
  resetStorikStore: StrorikServerResetStore
}

export const createStorikServerThings = <TRequest extends LikeRequest, TResponse extends LikeResponse>({
  getValue,
  setValue,
}: {
  getValue: (req: TRequest, key: string) => string | undefined
  setValue: (res: TResponse, key: string, value: string) => any
}) => {
  const applyStorikToExpressApp = ({ expressApp }: { expressApp: Express }): void => {
    expressApp.use((req: any, res: any, next: any) => {
      req.getStorikStore = ((storik: StroikAnyPersistent) => {
        const stringValue = getValue(req, storik.persistentKey)
        if (!stringValue) {
          return cloneDeep(storik.defaultValue)
        }
        const rawValue = storik.decode(stringValue)
        if (!storik.schema) {
          return rawValue
        }
        try {
          return storik.schema.parse(rawValue)
        } catch {
          return storik.schema.parse(cloneDeep(storik.defaultValue))
        }
      }) satisfies StrorikServerGetStore

      res.resetStorikStore = ((storik: StroikAnyPersistent, value: string) => {
        const validValue = storik.schema ? storik.schema.parse(value) : value
        const encodedValue = storik.encode(validValue)
        setValue(res, storik.persistentKey, encodedValue)
      }) satisfies StrorikServerResetStore

      next()
    })
  }

  return {
    applyStorikToExpressApp,
  }
}
