Te dejé completos core.ts, callExecutor.ts, modeEngines.ts y taskConclusion.ts. Aplicados los de las dos tandas, los tres motores ya no importan Decision20Engine, DiscoveryEngine ni QwenEngine de forma directa. No pude correr tsc, así que la compilación la comprobás vos con npx tsc --noEmit.

Supuestos de la tanda 1

Los dos que quedaron pendientes se confirman con lo que pasaste:

StepRoute está en types/routes.ts, así que el import de types/decision.ts es correcto.
environment.ts no importa nada del proyecto, solo módulos de Node, y types/plan.ts lo trae con import type, así que no hay ciclo.
Qué cambió
core.ts:
El constructor recibe { decisionEngine, discoveryEngine, llm }, sin valores por defecto.
Exporta el tipo JarvisCoreDeps.
Ya no importa ninguna implementación.
qwenEngine pasó a llm.
callExecutor.ts:
Los tipos ArgumentsGenerationResult, FailedAttempt y StepVerificationResult se importan de types.ts.
McpServer se deriva de IDiscoveryEngine.
La verificación de herramienta se simplificó: queda una sola llamada a validateToolExists, con el isStopped conservado y las llaves cuadradas.
modeEngines.ts: ReplanResult y DecisionOneResult vienen de types.ts, y el renombre a llm está aplicado.
taskConclusion.ts: solo el renombre a llm.
Qué queda sin desacoplar

Estos módulos siguen importando clases de las implementaciones, porque las usan en instanceof:

callExecutor.ts y taskConclusion.ts importan LLMServiceUnavailableError y LLMValidationError de qwen.ts.
modeEngines.ts importa LLMServiceUnavailableError de qwen.ts y DecisionServiceUnavailableError de decision.ts.
callExecutor.ts también importa cleanInputSchema de mcp/discovery.ts, que es una función pura.

Para cortar eso, las clases de error pasarían a un módulo hoja, por ejemplo llmTransport.ts, que ya tiene RequestAbortedError y TransportError. Necesitaría ese archivo para hacerlo. Dejarlo así no rompe nada.

Un riesgo para tsc

getDiscoveryEngine() en core.ts ahora devuelve IDiscoveryEngine, que solo tiene 4 métodos. Si jarvisRouter.ts o mcpRouter.ts lo usan para llamar a otros métodos, como getAllServers, tsc lo va a marcar. En ese caso, los routers deben recibir el discoveryEngine concreto desde server.ts, que es lo que ya hace hoy con mcpRouter.

Lo que falta

No pasaste server.ts en esta tanda. Lo necesito completo, en su versión actual con mis cambios anteriores, para cambiar la construcción a new JarvisCore({ decisionEngine, discoveryEngine, llm: qwenEngine }). Si algún router muestra el problema anterior, pasame también ese archivo.

Después de tsc, falta verificar que nada más use qwenEngine ni importe estos tipos desde los archivos viejos:

bash
grep -rn "qwenEngine" src server.ts --include=*.ts
grep -rnE 'from ".*/(decision|qwen|prompts)\.ts"' . --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git