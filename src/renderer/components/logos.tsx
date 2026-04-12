const sharedLogoStyles = `
	.volatile-logo {
		overflow: visible;
	}

	.logo-text {
		font-family: inherit;
		font-weight: 800;
		letter-spacing: -0.05em;
		pointer-events: none;
	}

	.v-main {
		fill: #ef4444;
	}

	.suffix {
		fill: currentColor;
		opacity: 0.9;
	}

	@keyframes glitch-rgb {
		0% { transform: translate(0); text-shadow: -2px 0 #ff00c1, 2px 0 #00fff9; }
		20% { transform: translate(-2px, 2px); text-shadow: -2px 0 #ff00c1, 2px 0 #00fff9; }
		40% { transform: translate(-2px, -2px); text-shadow: 2px 0 #ff00c1, -2px 0 #00fff9; }
		60% { transform: translate(2px, 2px); text-shadow: -2px 0 #ff00c1, 2px 0 #00fff9; }
		80% { transform: translate(2px, -2px); text-shadow: 2px 0 #ff00c1, -2px 0 #00fff9; }
		100% { transform: translate(0); text-shadow: -2px 0 #ff00c1, 2px 0 #00fff9; }
	}

	.volatile-logo:hover .glitch-target {
		animation: glitch-rgb 0.2s infinite;
	}
`

const loaderStyles = `
	.volatile-logo-loader {
		overflow: visible;
	}

	.logo-text {
		font-family: inherit;
		font-weight: 800;
		pointer-events: none;
		text-anchor: middle;
		dominant-baseline: middle;
	}

	.v-main {
		fill: #ef4444;
	}

	@keyframes glitch-loop {
		0%, 100% { transform: translate(0); text-shadow: -2px 0 #ff00c1, 2px 0 #00fff9; }
		5% { transform: translate(-3px, 1px); text-shadow: -3px 0 #ff00c1, 3px 0 #00fff9; }
		10% { transform: translate(3px, -1px); text-shadow: 3px 0 #ff00c1, -3px 0 #00fff9; }
		15% { transform: translate(-1px, 3px); text-shadow: -1px 0 #ff00c1, 1px 0 #00fff9; }
		20% { transform: translate(0); text-shadow: -2px 0 #ff00c1, 2px 0 #00fff9; }
		40% { transform: translate(0); text-shadow: none; }
		42% { transform: translate(2px, -2px); text-shadow: 2px 0 #ff00c1, -2px 0 #00fff9; }
		44% { transform: translate(0); text-shadow: none; }
	}

	.glitch-target {
		animation: glitch-loop 2.5s infinite;
	}
`

export function LogoWordmark(props: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 158 60'
			preserveAspectRatio='xMinYMid meet'
			className={[props.className, 'volatile-logo shrink-0 font-sans']
				.filter(Boolean)
				.join(' ')}
		>
			<style dangerouslySetInnerHTML={{ __html: sharedLogoStyles }} />
			<rect width='100%' height='100%' fill='transparent' />
			<g className='glitch-target'>
				<text x='10' y='48' className='logo-text v-main' fontSize='52'>
					V
				</text>
			</g>
			<text x='48' y='48' className='logo-text suffix' fontSize='34'>
				olatile
			</text>
		</svg>
	)
}

export function LogoLettermark(props: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 60 60'
			className={[props.className, 'volatile-logo shrink-0 font-sans']
				.filter(Boolean)
				.join(' ')}
		>
			<style dangerouslySetInnerHTML={{ __html: sharedLogoStyles }} />
			<rect width='100%' height='100%' fill='transparent' />
			<g className='glitch-target'>
				<text x='10' y='48' className='logo-text v-main' fontSize='52'>
					V
				</text>
			</g>
		</svg>
	)
}

export function LogoLoader(props: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 100 100'
			className={[props.className, 'volatile-logo-loader shrink-0 font-sans']
				.filter(Boolean)
				.join(' ')}
		>
			<style dangerouslySetInnerHTML={{ __html: loaderStyles }} />
			<rect width='100%' height='100%' fill='transparent' />
			<g className='glitch-target'>
				<text x='50' y='55' className='logo-text v-main' fontSize='80'>
					V
				</text>
			</g>
		</svg>
	)
}
