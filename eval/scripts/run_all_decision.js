import { execSync } from 'node:child_process';

const stagesConfig = [
  { stage: 'd0', variants: 'prod,auto_d0_20261122_053046_c3df_r25_a,auto_d0_20261122_053046_c3df_r11_a,auto_d0_20261122_053046_c3df_r29_a' },
  { stage: 'route', variants: 'prod,auto_route_20261122_040835_cd7c_r6_a,auto_route_20261122_060609_437e_r8_b,auto_route_20261122_060609_437e_r2_a' },
  { stage: 'tool_choice', variants: 'prod,auto_tool_choice_20261122_030825_6f4e_r1_a,auto_tool_choice_20261122_115503_9836_r1_a,auto_tool_choice_20261122_041844_1ad9_r1_b' },
  { stage: 'args_review', variants: 'prod,auto_args_review_20261122_042010_d86c_r9_b,auto_args_review_20261122_115602_4adb_r1_a,auto_args_review_20261122_115602_4adb_r5_b' },
  { stage: 'result_verification', variants: 'prod,result_verification_v1' },
  { stage: 'fragment_judge', variants: 'prod,auto_fragment_judge_20261122_121608_d57c_r4_b,auto_fragment_judge_20261122_043912_3d41_r1_a,auto_fragment_judge_20261122_121608_d57c_r2_b' },
  { stage: 'd5', variants: 'prod,auto_d5_20261122_023635_e498_r1_a,auto_d5_20261122_050001_9c8e_r2_a,auto_d5_20261122_050001_9c8e_r5_a' },
  { stage: 'recovery', variants: 'prod,auto_recovery_20261122_050755_df5c_r1_b,auto_recovery_20261122_050755_df5c_r2_b,auto_recovery_20261122_050755_df5c_r1_a' },
  { stage: 'continuation', variants: 'prod,auto_continuation_20261122_051614_c0f5_r6_a,auto_continuation_20261122_051614_c0f5_r7_a,auto_continuation_20261122_051614_c0f5_r4_a' }
];

console.log('Iniciando evaluación completa de etapas de decisión...');
for (const item of stagesConfig) {
  console.log('\n======================================================');
  console.log(`EJECUTANDO STAGE: ${item.stage} con variantes: ${item.variants}`);
  console.log('======================================================\n');
  const cmd = `npx tsx eval/cli.ts --stages=${item.stage} --variant=${item.variants} --concurrency=2 --decision-model=d3:2b-text --label=eval_${item.stage}`;
  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch (err) {
    console.error(`Error al ejecutar etapa ${item.stage}`);
    process.exit(1);
  }
}
console.log('\nTodas las etapas de decisión completadas con éxito.');
