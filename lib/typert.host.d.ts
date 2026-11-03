import { z } from "zod";

//#region src/typert.host.d.ts

declare const TYPERT: {
  package: string;
  face: string;
  schemas: unknown[];
  invocations: ({
    id: string;
    service: string;
    namespace: string;
    method: string;
    invocation: {
      kind: string;
    };
    parameters: ({
      name: string;
      wire: string;
      source: string;
      lookup: string;
      codec: {
        mode: string;
        typeSymbol: string;
        create: () => z.ZodIntersection<z.ZodString, z.ZodUnknown>;
      };
    } | {
      name: string;
      wire: string;
      source: string;
      codec: {
        mode: string;
        typeSymbol: string;
        create: () => z.ZodReadonly<z.ZodObject<{
          restart: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
      };
    })[];
    cancellation: {
      parameter: string;
    };
    result: {
      mode: string;
      typeSymbol: string;
      create: () => z.ZodReadonly<z.ZodObject<{
        url: z.ZodReadonly<z.ZodString>;
        port: z.ZodReadonly<z.ZodNumber>;
        ready: z.ZodReadonly<z.ZodBoolean>;
      }, z.core.$strip>>;
    };
    sourceLocation: {
      file: string;
      line: number;
      column: number;
    };
  } | {
    id: string;
    service: string;
    namespace: string;
    method: string;
    invocation: {
      kind: string;
    };
    parameters: {
      name: string;
      wire: string;
      source: string;
      lookup: string;
      codec: {
        mode: string;
        typeSymbol: string;
        create: () => z.ZodIntersection<z.ZodString, z.ZodUnknown>;
      };
    }[];
    cancellation: {
      parameter: string;
    };
    result: {
      mode: string;
      typeSymbol: string;
      create: () => z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        url: z.ZodReadonly<z.ZodString>;
        port: z.ZodReadonly<z.ZodNumber>;
        ready: z.ZodReadonly<z.ZodBoolean>;
      }, z.core.$strip>>, z.ZodNull]>;
    };
    sourceLocation: {
      file: string;
      line: number;
      column: number;
    };
  } | {
    id: string;
    service: string;
    namespace: string;
    method: string;
    invocation: {
      kind: string;
    };
    parameters: {
      name: string;
      wire: string;
      source: string;
      lookup: string;
      codec: {
        mode: string;
        typeSymbol: string;
        create: () => z.ZodIntersection<z.ZodString, z.ZodUnknown>;
      };
    }[];
    cancellation: {
      parameter: string;
    };
    result: {
      mode: string;
      typeSymbol: string;
      create: () => z.ZodVoid;
    };
    sourceLocation: {
      file: string;
      line: number;
      column: number;
    };
  } | {
    id: string;
    service: string;
    namespace: string;
    method: string;
    invocation: {
      kind: string;
    };
    parameters: {
      name: string;
      wire: string;
      source: string;
      lookup: string;
      codec: {
        mode: string;
        typeSymbol: string;
        create: () => z.ZodIntersection<z.ZodString, z.ZodUnknown>;
      };
    }[];
    cancellation: {
      parameter: string;
    };
    result: {
      mode: string;
      typeSymbol: string;
      create: () => z.ZodReadonly<z.ZodObject<{
        message: z.ZodReadonly<z.ZodString>;
      }, z.core.$strip>>;
    };
    sourceLocation: {
      file: string;
      line: number;
      column: number;
    };
  })[];
  model: {
    services: {
      description: string;
      summary: string;
      tags: string[];
      jsDoc: string;
      key: string;
      exportName: string;
      types: unknown[];
      members: {
        kind: string;
        name: string;
        signature: string;
        summary: string;
        jsDoc: string;
      }[];
    }[];
    events: unknown[];
    objects: unknown[];
  };
};
//#endregion
export { TYPERT, TYPERT as default };