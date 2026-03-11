export function LogoWordmark(props: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 260 90'
			className={`${props.className} volatile-logo`}
		>
			<defs>
				{/* Redis-inspired fiery gradient */}
				<linearGradient id='v-grad-left' x1='0%' y1='0%' x2='100%' y2='100%'>
					<stop offset='0%' stopColor='#FF3366' />
					<stop offset='100%' stopColor='#FF9933' />
				</linearGradient>
				{/* Memcached-inspired memory gradient */}
				<linearGradient id='v-grad-right' x1='0%' y1='0%' x2='100%' y2='100%'>
					<stop offset='0%' stopColor='#00C9FF' />
					<stop offset='100%' stopColor='#92FE9D' />
				</linearGradient>
			</defs>
			<style
				dangerouslySetInnerHTML={{
					__html:
						'\n        /* Self-contained SVG styles for the hover animation */\n        .volatile-logo {\n            overflow: visible;\n            cursor: pointer;\n        }\n        \n        /* Base transition states */\n        .v-left {\n            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);\n            transform-origin: 38px 45px;\n        }\n        .v-right {\n            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);\n            transform-origin: 62px 45px;\n        }\n        .text-volatile {\n            transition: all 0.3s ease;\n        }\n        .spark {\n            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);\n            opacity: 0;\n        }\n\n        /* Hover States: The "Volatile" reaction */\n        .volatile-logo:hover .v-left {\n            transform: translate(-4px, -2px) rotate(-3deg);\n            filter: drop-shadow(0px 4px 8px rgba(255, 51, 102, 0.6));\n        }\n        .volatile-logo:hover .v-right {\n            transform: translate(4px, -2px) rotate(3deg);\n            filter: drop-shadow(0px 4px 8px rgba(0, 201, 255, 0.6));\n        }\n        .volatile-logo:hover .text-volatile {\n            transform: translateX(3px);\n            letter-spacing: 0.02em;\n        }\n        \n        /* Spark ejections on hover */\n        .volatile-logo:hover .spark-1 {\n            transform: translate(-14px, -16px) scale(1.5);\n            opacity: 0.9;\n        }\n        .volatile-logo:hover .spark-2 {\n            transform: translate(14px, -16px) scale(1.5);\n            opacity: 0.9;\n        }\n        .volatile-logo:hover .spark-3 {\n            transform: translate(-8px, 18px) scale(1.5);\n            opacity: 0.9;\n        }\n        .volatile-logo:hover .spark-4 {\n            transform: translate(8px, 18px) scale(1.5);\n            opacity: 0.9;\n        }\n    ',
				}}
			/>
			{/* Energy Sparks (hidden by default, eject on hover) */}
			<circle className='spark spark-1' cx={32} cy={30} r='2.5' fill='#FF3366' />
			<circle className='spark spark-2' cx={68} cy={30} r={2} fill='#00C9FF' />
			<circle className='spark spark-3' cx={44} cy={62} r='1.5' fill='#FF9933' />
			<circle className='spark spark-4' cx={56} cy={62} r={2} fill='#92FE9D' />
			{/* The "V" Graphic Component */}
			{/* Right Line (Memcached Blue/Green - Back layer) */}
			<line
				className='v-right'
				x1={72}
				y1={24}
				x2={52}
				y2={66}
				stroke='url(#v-grad-right)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
			{/* Left Line (Redis Red/Orange - Front layer) */}
			<line
				className='v-left'
				x1={28}
				y1={24}
				x2={48}
				y2={66}
				stroke='url(#v-grad-left)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
			{/* The Text Component */}
			<text
				className='text-volatile fill-current text-foreground'
				x={75}
				y={64}
				fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
				fontSize={44}
				fontWeight={800}
				letterSpacing='-0.01em'
			>
				olatile
			</text>
		</svg>
	)
}

export function LogoLettermark(props: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 100 100'
			className={`${props.className} volatile-logo`}
		>
			<defs>
				{/* Redis-inspired fiery gradient */}
				<linearGradient id='v-grad-left' x1='0%' y1='0%' x2='100%' y2='100%'>
					<stop offset='0%' stopColor='#FF3366' />
					<stop offset='100%' stopColor='#FF9933' />
				</linearGradient>
				{/* Memcached-inspired memory gradient */}
				<linearGradient id='v-grad-right' x1='0%' y1='0%' x2='100%' y2='100%'>
					<stop offset='0%' stopColor='#00C9FF' />
					<stop offset='100%' stopColor='#92FE9D' />
				</linearGradient>
			</defs>
			<style
				dangerouslySetInnerHTML={{
					__html:
						'\n        /* Self-contained SVG styles for the hover animation */\n        .volatile-logo {\n            overflow: visible;\n            cursor: pointer;\n        }\n        \n        /* Base transition states */\n        .v-left {\n            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);\n            transform-origin: 38px 50px;\n        }\n        .v-right {\n            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);\n            transform-origin: 62px 50px;\n        }\n        .spark {\n            transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);\n            opacity: 0;\n        }\n\n        /* Hover States: The "Volatile" reaction */\n        .volatile-logo:hover .v-left {\n            transform: translate(-4px, -2px) rotate(-3deg);\n            filter: drop-shadow(0px 4px 8px rgba(255, 51, 102, 0.6));\n        }\n        .volatile-logo:hover .v-right {\n            transform: translate(4px, -2px) rotate(3deg);\n            filter: drop-shadow(0px 4px 8px rgba(0, 201, 255, 0.6));\n        }\n        \n        /* Spark ejections on hover */\n        .volatile-logo:hover .spark-1 {\n            transform: translate(-14px, -16px) scale(1.5);\n            opacity: 0.9;\n        }\n        .volatile-logo:hover .spark-2 {\n            transform: translate(14px, -16px) scale(1.5);\n            opacity: 0.9;\n        }\n        .volatile-logo:hover .spark-3 {\n            transform: translate(-8px, 18px) scale(1.5);\n            opacity: 0.9;\n        }\n        .volatile-logo:hover .spark-4 {\n            transform: translate(8px, 18px) scale(1.5);\n            opacity: 0.9;\n        }\n    ',
				}}
			/>
			{/* Energy Sparks (hidden by default, eject on hover) */}
			<circle className='spark spark-1' cx={32} cy={35} r='2.5' fill='#FF3366' />
			<circle className='spark spark-2' cx={68} cy={35} r={2} fill='#00C9FF' />
			<circle className='spark spark-3' cx={44} cy={67} r='1.5' fill='#FF9933' />
			<circle className='spark spark-4' cx={56} cy={67} r={2} fill='#92FE9D' />
			{/* The "V" Graphic Component */}
			{/* Right Line (Memcached Blue/Green - Back layer) */}
			<line
				className='v-right'
				x1={72}
				y1={29}
				x2={52}
				y2={71}
				stroke='url(#v-grad-right)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
			{/* Left Line (Redis Red/Orange - Front layer) */}
			<line
				className='v-left'
				x1={28}
				y1={29}
				x2={48}
				y2={71}
				stroke='url(#v-grad-left)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
		</svg>
	)
}

export function LogoLoader(props: { className?: string }) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			viewBox='0 0 100 100'
			className={`${props.className} volatile-logo-pulse`}
		>
			<defs>
				<linearGradient id='v-grad-left-2' x1='0%' y1='0%' x2='100%' y2='100%'>
					<stop offset='0%' stopColor='#FF3366' />
					<stop offset='100%' stopColor='#FF9933' />
				</linearGradient>
				<linearGradient id='v-grad-right-2' x1='0%' y1='0%' x2='100%' y2='100%'>
					<stop offset='0%' stopColor='#00C9FF' />
					<stop offset='100%' stopColor='#92FE9D' />
				</linearGradient>
			</defs>
			<style
				dangerouslySetInnerHTML={{
					__html:
						'\n                    .volatile-loader-pulse { overflow: visible; }\n                    .v-base-2 { opacity: 0.15; }\n                    .draw-left-2 { stroke-dasharray: 55; animation: draw-pulse-2 2s cubic-bezier(0.76, 0, 0.24, 1) infinite; filter: drop-shadow(0 0 5px rgba(255, 51, 102, 0.7)); }\n                    .draw-right-2 { stroke-dasharray: 55; animation: draw-pulse-2 2s cubic-bezier(0.76, 0, 0.24, 1) infinite 0.1s; filter: drop-shadow(0 0 5px rgba(0, 201, 255, 0.7)); }\n                    @keyframes draw-pulse-2 { 0%, 15% { stroke-dashoffset: 55; opacity: 0; } 35%, 65% { stroke-dashoffset: 0; opacity: 1; } 85%, 100% { stroke-dashoffset: -55; opacity: 0; } }\n                ',
				}}
			/>
			<line
				className='v-base-2'
				x1={72}
				y1={29}
				x2={52}
				y2={71}
				stroke='url(#v-grad-right-2)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
			<line
				className='v-base-2'
				x1={28}
				y1={29}
				x2={48}
				y2={71}
				stroke='url(#v-grad-left-2)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
			<line
				className='draw-left-2'
				x1={48}
				y1={71}
				x2={28}
				y2={29}
				stroke='url(#v-grad-left-2)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
			<line
				className='draw-right-2'
				x1={52}
				y1={71}
				x2={72}
				y2={29}
				stroke='url(#v-grad-right-2)'
				strokeWidth={14}
				strokeLinecap='round'
			/>
		</svg>
	)
}
