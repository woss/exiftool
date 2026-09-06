<script lang="ts">
	import { ExifTool } from 'exiftool-ts';

	let file: File | null = $state(null);
	let tags: Record<string, unknown> | null = $state(null);
	let format: string | null = $state(null);
	let loading = $state(false);
	let error: string | null = $state(null);
	let parseTimeMs: number | null = $state(null);
	let metadataBytes: number | null = $state(null);
	let width: number | null = $state(null);
	let height: number | null = $state(null);
	let pixelBytes: number | null = $state(null);

	const tool = new ExifTool();

	let dragOver = $state(false);

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		dragOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
		if (!event.dataTransfer?.files?.length) return;
		const input = document.getElementById('file-input') as HTMLInputElement;
		if (input) {
			input.files = event.dataTransfer.files;
			const changeEvent = new Event('change', { bubbles: true });
			input.dispatchEvent(changeEvent);
		}
	}

	async function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files?.length) return;

		file = input.files[0];
		loading = true;
		error = null;
		tags = null;
		format = null;
		parseTimeMs = null;
		metadataBytes = null;
		width = null;
		height = null;
		pixelBytes = null;

		try {
			const arrayBuffer = await file.arrayBuffer();
			const bytes = new Uint8Array(arrayBuffer);
			const t0 = performance.now();
			const info = await tool.readBytes(bytes);
			parseTimeMs = performance.now() - t0;
			tags = info.tags;
			format = info.format;
			metadataBytes = findMetadataBytes(bytes);
			width = toNumber(info.tags.ImageWidth);
			height = toNumber(info.tags.ImageHeight);
			pixelBytes = findPixelBytes(bytes, width, height);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to read EXIF data';
		} finally {
			loading = false;
		}
	}

	function toNumber(value: unknown): number | null {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 ? n : null;
	}

	/**
	 * Size in bytes of the embedded metadata container (EXIF block).
	 * Handles JPEG APP1 (Exif\0\0), PNG eXIf, and WebP EXIF chunks.
	 */
	function findMetadataBytes(bytes: Uint8Array): number | null {
		// JPEG: scan APPn segments for APP1 with Exif\0\0 signature
		if (bytes[0] === 0xff && bytes[1] === 0xd8) {
			let i = 2;
			while (i + 4 < bytes.length) {
				if (bytes[i] === 0xff) {
					const marker = bytes[i + 1];
					if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
						i += 2;
						continue;
					}
					const len = (bytes[i + 2] << 8) | bytes[i + 3];
					if (
						marker === 0xe1 &&
						len >= 6 &&
						String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7], bytes[i + 8], bytes[i + 9]) === 'Exif\0\0'
					) {
						return len - 2;
					}
					i += 2 + len;
				} else {
					i++;
				}
			}
			return null;
		}

		// Generic: locate the Exif\0\0 signature and read the container size.
		// PNG: 4-byte big-endian length precedes the chunk type (12 overhead: len+type+crc).
		// WebP: 4-byte little-endian size follows the "EXIF" chunk type (8 overhead).
		const sig = 'Exif\0\0';
		const text = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 8192)));
		const idx = text.indexOf(sig);
		if (idx === -1) return null;

		const png = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
		if (png === '\x89PNG') {
			const end = idx + sig.length;
			const len = (bytes[end - 8] << 24) | (bytes[end - 7] << 16) | (bytes[end - 6] << 8) | bytes[end - 5];
			return len > 0 && len < bytes.length ? len + 12 : null;
		}
		if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') {
			const size = bytes[idx + sig.length] | (bytes[idx + sig.length + 1] << 8) | (bytes[idx + sig.length + 2] << 16) | (bytes[idx + sig.length + 3] << 24);
			return size > 0 && size < bytes.length - idx ? size + 8 : null;
		}
		return null;
	}

	/**
	 * Size in bytes of the actual compressed pixel data.
	 * JPEG: entropy-coded segment (SOS header end → EOI).
	 * PNG:  sum of IDAT chunk payloads.
	 * WebP: VP8/VP8L chunk payloads.
	 * Falls back to an uncompressed width×height×3 estimate for other formats.
	 */
	function findPixelBytes(bytes: Uint8Array, width: number | null, height: number | null): number | null {
		// JPEG: entropy-coded segment between SOS (FF DA) header end and EOI (FF D9)
		if (bytes[0] === 0xff && bytes[1] === 0xd8) {
			let i = 2;
			let sos = -1;
			while (i + 4 < bytes.length) {
				if (bytes[i] === 0xff) {
					const marker = bytes[i + 1];
					if (marker === 0xda) {
						sos = i;
						break;
					}
					if (marker === 0xd9) break;
					if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
						i += 2;
						continue;
					}
					const len = (bytes[i + 2] << 8) | bytes[i + 3];
					i += 2 + len;
				} else {
					i++;
				}
			}
			if (sos === -1) return width && height ? width * height * 3 : null;
			const hdrEnd = sos + 2 + ((bytes[sos + 2] << 8) | bytes[sos + 3]);
			for (let j = hdrEnd; j + 1 < bytes.length; j++) {
				if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) return j - hdrEnd;
			}
			return bytes.length - hdrEnd;
		}

		// PNG: sum IDAT chunk payloads
		if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === '\x89PNG') {
			let total = 0;
			let i = 8;
			while (i + 12 <= bytes.length) {
				const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
				const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
				if (type === 'IDAT') total += len;
				if (type === 'IEND' || len <= 0 || i + 12 + len > bytes.length) break;
				i += 12 + len;
			}
			return total > 0 ? total : width && height ? width * height * 3 : null;
		}

		// WebP: sum VP8/VP8L chunk payloads (little-endian sizes)
		if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF') {
			let total = 0;
			let i = 12;
			while (i + 8 <= bytes.length) {
				const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
				const size = (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0;
				if (type === 'VP8 ' || type === 'VP8L') total += size;
				if (size === 0 || i + 8 + size > bytes.length) break;
				i += 8 + size + (size % 2);
			}
			return total > 0 ? total : width && height ? width * height * 3 : null;
		}

		return width && height ? width * height * 3 : null;
	}

	function formatBytes(n: number | null): string {
		if (n === null) return '—';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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
	<div class="upload-area" role="button" ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop} class:drag-over={dragOver}>
		<input id="file-input" type="file" accept="image/*" onchange={handleFileChange} disabled={loading} />
		<label for="file-input" class="upload-label">
			<p class="hint">Click or drag an image file here (JPEG, PNG, WebP, TIFF, DNG, AVIF, HEIC)</p>
		</label>
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

			<div class="debug-bar">
				<div class="stat">
					<span class="stat-label">Parse time</span>
					<span class="stat-value">{parseTimeMs !== null ? `${parseTimeMs.toFixed(1)} ms` : '—'}</span>
				</div>
				<div class="stat">
					<span class="stat-label">Metadata</span>
					<span class="stat-value">{formatBytes(metadataBytes)}</span>
				</div>
				<div class="stat">
					<span class="stat-label">Image</span>
					<span class="stat-value">
						{width && height ? `${width}×${height} px` : '—'}
						{#if pixelBytes !== null}<small>{formatBytes(pixelBytes)} pixel data</small>{/if}
					</span>
				</div>
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

	.upload-area.drag-over {
		border-color: #0066cc;
		background: #e8f0fe;
	}

	.upload-area input {
		display: none;
	}

	.upload-label {
		display: block;
		cursor: pointer;
		width: 100%;
		height: 100%;
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

	.debug-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.stat {
		flex: 1;
		min-width: 140px;
		background: #f0f4f8;
		border: 1px solid #d5e0ea;
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.stat-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #667;
	}

	.stat-value {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.95rem;
		font-weight: 600;
		color: #0a2540;
	}

	.stat-value small {
		font-weight: 400;
		font-size: 0.75rem;
		color: #667;
		margin-left: 0.4rem;
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