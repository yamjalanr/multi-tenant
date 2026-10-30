"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { log } from "console";

const Navbar = (handleClick: any) => {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
  }, []);

  console.log(router,pathname);
  

  return (
    <div className="bg-red">
      <div className="header-title" >
       <Link href={`${pathname}`} className="flex items-center justify-center cursor-pointer" >
              <h1 className='pl-5'>Multi Tenant App</h1>
          </Link>
      </div>
    </div>
  );
};

export default Navbar;
