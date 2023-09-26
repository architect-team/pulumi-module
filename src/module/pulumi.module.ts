import { spawnSync } from 'child_process';
import { ApplyInputs, BaseModule, BuildInputs, ImageDigest, PulumiStateString } from "./base.module";

export class PulumiModule extends BaseModule {
  // build an image that pulumi code can be run on
  async build(inputs: BuildInputs): Promise<{ digest?: ImageDigest, error?: string }> {
    const args = ['build', inputs.directory, '--quiet'];
    console.log(`Building image with args: ${args.join('\n')}`);
    const docker_result = spawnSync('docker', args, { cwd: inputs.directory });

    let error;
    if (docker_result.error) {
      error = docker_result.error.message;
    } else if (docker_result.stderr?.length) {
      error = docker_result.stderr.toString();
    }

    return { digest: docker_result.stdout?.toString().replace('sha256:', '').trim(), error };
  }

  // run pulumi image and apply provided pulumi
  async apply(inputs: ApplyInputs): Promise<{ state?: PulumiStateString, outputs: Record<string, string>, error?: string }> {
    // set variables as secrets for the pulumi stack
    let pulumi_config = '';
    if (!inputs.datacenterid) {
      inputs.datacenterid = 'default';
    }
    if ((inputs.inputs || []).length) {
      const config_pairs = inputs.inputs.reduce((acc, element) => {
        const [key, value] = element;
        acc.push(`--plaintext ${key}="${value}"`);
        if (key.includes(':')) {
          acc.push(`--path --plaintext "${key.replace(':', '.')}"="${value}"`);
        }
        return acc;
      }, [] as string[]).join(' ');
      pulumi_config = `pulumi config --stack ${inputs.datacenterid} set-all ${config_pairs} &&`;
    }
    console.log(`Pulumi config: ${pulumi_config}`);
    const apply_or_destroy = inputs.destroy ? 'destroy' : 'up';
    const environment = ['-e', 'PULUMI_CONFIG_PASSPHRASE=']; // ignore this pulumi requirement

    // set pulumi state to the state passed in, if it was supplied
    const state_file = 'pulumi-state.json';
    const state_write_cmd = inputs.state ? `echo '${inputs.state}' > ${state_file}` : '';
    const state_import_cmd = inputs.state ? `pulumi stack import --stack ${inputs.datacenterid} --file ${state_file} &&` : '';
    const pulumi_delimiter = '****PULUMI_DELIMITER****';

    const args = [
      'run',
      //'--rm',
      '--entrypoint',
      'bash',
      ...environment,
      inputs.image,
      '-c',
      `
        ${state_write_cmd}
        pulumi login --local &&
        pulumi stack init --stack ${inputs.datacenterid} &&
        ${state_import_cmd}
        pulumi refresh --stack ${inputs.datacenterid} --non-interactive --yes &&
        ${pulumi_config}
        pulumi ${apply_or_destroy} --stack ${inputs.datacenterid} --non-interactive --yes &&
        echo "${pulumi_delimiter}" &&
        pulumi stack export --stack ${inputs.datacenterid} &&
        echo "${pulumi_delimiter}" &&
        pulumi stack output --show-secrets -j
      `
    ];
    console.log(`Running pulumi with args: ${args.join('\n')}`);
    console.log(JSON.stringify(inputs));
    const docker_result = spawnSync('docker', args, {
      stdio: 'pipe',
    });

    let error;
    if (docker_result.error) {
      error = docker_result.error.message;
    } else if (docker_result.stdout && !docker_result.stdout.includes(pulumi_delimiter)) {
      error = docker_result.stdout.toString();
    } else if (docker_result.stderr?.length) {
      error = docker_result.stderr.toString();
    }

    const output_parts = docker_result.stdout.toString().split(pulumi_delimiter);
    const outputs = JSON.parse(output_parts[2] || '{}');
    return { state: output_parts[1], outputs: outputs, error };
  }
}
