'use client'

import { useState, useEffect } from 'react'

export default function Hamburger() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handlePageLoad = () => {
      const navLinks = document.getElementById('nav-links')
      if (navLinks) {
        navLinks.classList.remove('open', 'collapsed')
        navLinks.classList.add(isOpen ? 'open' : 'collapsed')
      }
    }

    document.addEventListener('astro:page-load', handlePageLoad)
    return () => {
      document.removeEventListener('astro:page-load', handlePageLoad)
    }
  }, [isOpen])

  const toggleMenu = () => {
    setIsOpen(!isOpen)
    const navLinks = document.getElementById('nav-links')
    if (navLinks) {
      if (navLinks.classList.contains('open')) {
        navLinks.classList.remove('open')
        navLinks.classList.add('collapsed')
      } else {
        navLinks.classList.remove('collapsed')
        navLinks.classList.add('open')
      }
    }
  }

  return (
    <button
      onClick={toggleMenu}
      className="w-[30px] h-[30px] bg-transparent border-0 p-0 cursor-pointer relative hamburger flex items-center justify-center"
      aria-label={isOpen ? "Close menu" : "Open menu"}
    >
      <div className={`relative w-[24px] h-[18px] transition-all duration-300`}>
        <span
          className={`absolute h-[2px] w-full bg-current left-0 transition-all duration-300 ${
            isOpen 
              ? 'rotate-45 translate-y-[8px] top-0' 
              : 'rotate-0 translate-y-0 top-0'
          }`}
        />
        <span
          className={`absolute h-[2px] w-full bg-current left-0 top-[8px] transition-opacity duration-300 ${
            isOpen ? 'opacity-0' : 'opacity-100'
          }`}
        />
        <span
          className={`absolute h-[2px] w-full bg-current left-0 transition-all duration-300 ${
            isOpen 
              ? 'rotate-[-45deg] translate-y-[-8px] top-[16px]' 
              : 'rotate-0 translate-y-0 top-[16px]'
          }`}
        />
      </div>
    </button>
  )
}
