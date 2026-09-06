<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>exiftool-ts Demo — Browser EXIF Reader</title>
</svelte:head>

<div class="layout">
	<header>
		<h1>exiftool-ts Demo</h1>
		<p>Read EXIF metadata in the browser — no server upload required</p>
	</header>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.layout {
		min-height: 100vh;
		background: #f5f5f5;
	}

	header {
		background: white;
		padding: 1.5rem 1rem;
		border-bottom: 1px solid #ddd;
		text-align: center;
	}

	header h1 {
		margin: 0 0 0.25rem;
		font-size: 1.75rem;
		font-weight: 600;
		color: #111;
	}

	header p {
		margin: 0;
		color: #666;
		font-size: 1rem;
	}

	main {
		padding: 1rem;
	}
</style>
