<script lang="ts">
	import { ExifTool } from 'exiftool-ts';

	let file: File | null = $state(null);
	let tags: Record<string, unknown> | null = $state(null);
	let format: string | null = $state(null);
	let loading = $state(false);
	let error: string | null = $state(null);

	const tool = new ExifTool();

	async function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files?.length) return;

		file = input.files[0];
		loading = true;
		error = null;
		tags = null;
		format = null;

		try {
			const arrayBuffer = await file.arrayBuffer();
			const info = await tool.read(new Uint8Array(arrayBuffer), file.name);
			tags = info.tags;
			format = info.format;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to read EXIF data';
		} finally {
			loading = false;
		}
	}

	function formatValue(value: unknown): string {
		if (value === null || value === undefined) return '';
		if (value instanceof Uint8Array) {
			return `[Binary data: ${value.length} bytes]`;
		}
		if (Array.isArray(value)) {
			return value.map(formatValue).join(', ');
		}
		if (typeof value === 'object') {
			return JSON.stringify(value, null, 2);
		}
		return String(value);
	}

	function groupTags(tags: Record<string, unknown>): Record<string, Record<string, unknown>> {
		const groups: Record<string, Record<string, unknown>> = {};
		for (const [key, value] of Object.entries(tags)) {
			const group = key.split(':')[0] || 'Other';
			if (!groups[group]) groups[group] = {};
			groups[group][key] = value;
		}
		return groups;
	}
</script>

<div class="container">
	<div class="upload-area">
		<input type="file" accept="image/*" onchange={handleFileChange} disabled={loading} />
		<p class="hint">Select an image file (JPEG, PNG, WebP, TIFF, DNG, AVIF, HEIC)</p>
	</div>

	{#if loading}
		<div class="loading">Reading EXIF data...</div>
	{/if}

	{#if error}
		<div class="error">{error}</div>
	{/if}

	{#if tags && format}
		<div class="results">
			<div class="header">
				<h2>{file?.name}</h2>
				<span class="format-badge">{format}</span>
			</div>

			<div class="tags">
				{#each Object.entries(groupTags(tags)) as [group, groupTags]}
					<details open>
						<summary>{group} ({Object.keys(groupTags).length})</summary>
						<table>
							<tbody>
								{#each Object.entries(groupTags) as [key, value]}
									<tr>
										<td class="tag-name">{key}</td>
										<td class="tag-value">{formatValue(value)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: 1rem;
		font-family: system-ui, sans-serif;
	}

	.upload-area {
		border: 2px dashed #ccc;
		border-radius: 8px;
		padding: 2rem;
		text-align: center;
		margin-bottom: 1rem;
		transition: border-color 0.2s;
	}

	.upload-area:hover {
		border-color: #0066cc;
	}

	.upload-area input {
		display: none;
	}

	.hint {
		margin: 0.5rem 0 0;
		color: #666;
		font-size: 0.9rem;
	}

	.loading {
		padding: 1rem;
		text-align: center;
		color: #666;
	}

	.error {
		padding: 1rem;
		background: #fee;
		border: 1px solid #fcc;
		border-radius: 4px;
		color: #c00;
		margin-bottom: 1rem;
	}

	.results {
		margin-top: 1rem;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.header h2 {
		margin: 0;
		font-size: 1.2rem;
		word-break: break-all;
	}

	.format-badge {
		background: #0066cc;
		color: white;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.tags details {
		border: 1px solid #ddd;
		border-radius: 4px;
		margin-bottom: 0.5rem;
		background: #fafafa;
	}

	.tags summary {
		padding: 0.75rem 1rem;
		font-weight: 600;
		cursor: pointer;
		background: #f0f0f0;
		border-bottom: 1px solid #ddd;
	}

	.tags summary:hover {
		background: #e8e8e8;
	}

	.tags table {
		width: 100%;
		border-collapse: collapse;
		margin: 0;
	}

	.tags td {
		padding: 0.5rem 1rem;
		border-bottom: 1px solid #eee;
		vertical-align: top;
	}

	.tags td:last-child {
		border-bottom: none;
	}

	.tag-name {
		font-weight: 500;
		color: #333;
		width: 30%;
		white-space: nowrap;
	}

	.tag-value {
		font-family: monospace;
		font-size: 0.9rem;
		color: #555;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>